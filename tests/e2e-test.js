/* ============================================================
 * 端到端测试：TTS 合成已知英文 → MP3 → ffmpeg 转 WAV → 转写 → 比对
 *
 * 验证整条链路（格式转换 + 识别）是否正常。
 * 用法：node tests/e2e-test.js
 *
 * 注意：TTS 合成音不自然，错误率会明显高于真人录音。
 *       要测真实准确度请用 tests/benchmark.js（真人录音 + 官方真值）。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, execSync } from 'node:child_process';
import { resolveFfmpeg, MODEL, TOKENS, TMP_DIR, reportProblems, checkDeps } from '../lib/paths.js';
import { wer, describeOps } from '../lib/wer.js';

/* ffmpeg 是可选依赖（纯 wav 场景不需要），这里必须显式解析 */
const FFMPEG = resolveFfmpeg();
if (!FFMPEG) {
  reportProblems(checkDeps({ needFfmpeg: true }));
  console.error('本测试需要 ffmpeg 做 MP3 编解码。执行 npm install 或设置 FFMPEG_PATH。');
  process.exit(1);
}

/* 本测试用 Windows 自带的 System.Speech 合成语音作为已知内容的测试素材。
   其他平台没有这个 API，优雅跳过而不是报错（CI 会在三个系统上跑）。 */
if (process.platform !== 'win32' && !process.env.ASR_E2E_FORCE) {
  console.log('跳过：本测试依赖 Windows System.Speech 做 TTS 合成。');
  console.log('     当前平台 ' + process.platform + '，无此 API。');
  console.log('     想跳过 TTS、直接用已有音频测端到端，请设置 ASR_E2E_FORCE=1 并放入');
  console.log('     ' + path.join(TMP_DIR, 'e2e', 'known.wav'));
  console.log('     真实准确度评测请看 tests/benchmark.js（跨平台可用）。');
  process.exit(0);
}

const TMP = path.join(TMP_DIR, 'e2e');
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });

/* 已知内容的英文句子（模仿听力材料风格） */
const SENTENCES = [
  'The most striking finding was that babies who were exposed to higher levels of light in the early afternoon were better sleepers.',
  'Dr. Harrison conducted a study involving fifty-six sets of parents over three consecutive days.',
  'Parents were asked to keep a diary of their babies crying and sleeping.',
  'Reading about real people makes the flight feel shorter, and he enjoys the mental escape to different places.',
];
const SCRIPT = SENTENCES.join(' ');

/* ---------- 1. Windows TTS 合成语音 ---------- */
console.log('=== 1. 用 Windows TTS 合成语音（已知内容） ===');
const wavOut = path.join(TMP, 'known.wav');
const psScript = [
  'Add-Type -AssemblyName System.Speech',
  '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
  '$s.Rate = 0',
  '$s.SetOutputToWaveFile("' + wavOut + '")',
  '$s.Speak("' + SCRIPT.replace(/"/g, '`"') + '")',
  '$s.Dispose()',
].join('; ');

try {
  execSync('powershell.exe -NoProfile -Command "' + psScript.replace(/"/g, '\\"') + '"', { encoding: 'utf8', timeout: 120000 });
} catch (e) {
  console.log('  TTS 失败: ' + (e.stdout || e.message).toString().slice(0, 200));
}
if (!fs.existsSync(wavOut)) { console.error('  未生成 wav，终止'); process.exit(1); }
console.log('  生成 known.wav  ' + (fs.statSync(wavOut).size / 1024).toFixed(0) + 'KB');

/* ---------- 2. 转成 MP3（模拟作业音频格式） ---------- */
console.log('\n=== 2. ffmpeg 转 MP3（128k，模拟平台音频） ===');
const mp3 = path.join(TMP, 'known.mp3');
try {
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', wavOut, '-codec:a', 'libmp3lame', '-b:a', '128k', '-ar', '44100', mp3],
    { stdio: 'pipe', timeout: 120000 });
  console.log('  生成 known.mp3  ' + (fs.statSync(mp3).size / 1024).toFixed(0) + 'KB');
} catch (e) {
  console.error('  ffmpeg 失败: ' + (e.stderr || e.message).toString().slice(0, 200));
  process.exit(1);
}

/* ---------- 3. MP3 转回识别所需的 16k 单声道 WAV ---------- */
console.log('\n=== 3. ffmpeg 转 16k 单声道 WAV ===');
const conv = path.join(TMP, 'known-16k.wav');
try {
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', mp3, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', conv],
    { stdio: 'pipe', timeout: 120000 });
  console.log('  生成 known-16k.wav  ' + (fs.statSync(conv).size / 1024).toFixed(0) + 'KB');
} catch (e) {
  console.error('  转换失败: ' + (e.stderr || e.message).toString().slice(0, 200));
  process.exit(1);
}

/* ---------- 4. 转写 ---------- */
console.log('\n=== 4. SenseVoice 转写 ===');
const sherpa = await import('sherpa-onnx-node');
const { OfflineRecognizer, readWave } = sherpa.default || sherpa;

const recognizer = new OfflineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    senseVoice: { model: MODEL, useInverseTextNormalization: 1, language: 'en' },
    tokens: TOKENS,
    numThreads: 4,
    provider: 'cpu',
    debug: 0,
  },
  decodingMethod: 'greedy_search',
});

const t0 = Date.now();
const wave = readWave(conv);
const st = recognizer.createStream();
st.acceptWaveform({ samples: wave.samples, sampleRate: wave.sampleRate });
recognizer.decode(st);
const got = recognizer.getResult(st).text.trim();
const elapsed = (Date.now() - t0) / 1000;

const dur = wave.samples.length / wave.sampleRate;
console.log('  音频 ' + dur.toFixed(1) + 's，识别 ' + elapsed.toFixed(2) + 's（' + (dur / elapsed).toFixed(0) + '× 实时）\n');

console.log('--- 原文（TTS 输入）---');
console.log(SCRIPT);
console.log('\n--- 识别结果 ---');
console.log(got);

/* ---------- 5. 比对 ---------- */
const w = wer(SCRIPT, got, true);
console.log('\n--- 比对 ---');
console.log('  参考 ' + w.refLen + ' 词，正确 ' + w.correct + ' 词，错误 ' + w.distance +
  '，词错误率 ' + (w.rate * 100).toFixed(1) + '%');
if (w.ops.length) console.log('  差异: ' + describeOps(w.ops));

console.log('\n--- 关键信息点 ---');
const checks = [
  ['most striking finding', /most striking finding/i],
  ['babies', /babies/i],
  ['higher levels of light', /higher levels? of light/i],
  ['early afternoon', /early afternoon/i],
  ['better sleepers', /better sleepers/i],
  ['consecutive days', /consecutive days/i],
  ['diary', /diary/i],
  ['mental escape', /mental escape/i],
  ['flight', /flight/i],
];
let hit = 0;
for (const [name, re] of checks) {
  const ok = re.test(got);
  if (ok) hit++;
  console.log('  ' + (ok ? '✓' : '✗') + ' ' + name);
}
console.log('\n关键点命中 ' + hit + ' / ' + checks.length);
console.log('\n提示：合成音不自然会引入错误，真实准确度请看 tests/benchmark.js');
process.exit(hit === checks.length ? 0 : 1);
