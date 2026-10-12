/* ============================================================
 * 准确度矩阵实测：不同语音 / 语速 / 语言，量化 WER
 *
 *   node tests/accuracy-matrix.mjs
 *
 * 目的：为文档里的"适用范围与局限"提供可复现的数据，而不是凭印象写。
 *
 * 方法：用 Windows 系统 TTS 合成已知文本 → 转写 → 算词/字错误率。
 * 注意：TTS 合成音**不能代表真人**（真人在 benchmark.js 里测，0% 错误）。
 *       这里测的是"条件变差时会退化到什么程度"的相对趋势。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { MODEL, TOKENS, TMP_DIR, resolveFfmpeg } from '../lib/paths.js';

/** 测试产物统一写到临时目录，绝不落进仓库 */
const RESULTS_DIR = path.join(TMP_DIR, 'results');
fs.mkdirSync(RESULTS_DIR, { recursive: true });
import { wer, describeOps } from '../lib/wer.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WORK = path.join(TMP_DIR, 'accuracy-matrix');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

/* ---------- 测试文本 ---------- */
const TEXTS = {
  en: 'The most striking finding was that babies who were exposed to higher levels of light in the early afternoon were better sleepers than those who were not.',
  zh: '这项研究发现，下午早些时候接受较多光照的婴儿，夜间睡眠质量明显更好。',
  ja: 'この研究によると、午後の早い時間に多くの光を浴びた赤ちゃんは、夜よく眠れるということです。',
};

/* ---------- 用 TTS 合成 ---------- */
function synth(text, voice, rate, outWav) {
  const ps = [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    voice ? `$s.SelectVoice("${voice}")` : '',
    `$s.Rate = ${rate}`,
    `$s.SetOutputToWaveFile("${outWav}")`,
    `$s.Speak("${text.replace(/"/g, '`"')}")`,
    '$s.Dispose()',
  ].filter(Boolean).join('; ');
  const tmp = path.join(WORK, '_t.ps1');
  /* 写成 UTF-8 BOM 的 ps1，避免中文/日文经命令行传参被编码破坏 */
  fs.writeFileSync(tmp, '\uFEFF' + ps, 'utf8');
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp],
    { stdio: 'pipe', timeout: 120000 });
  return fs.existsSync(outWav) && fs.statSync(outWav).size > 1000;
}

/* ---------- 可用语音列表 ---------- */
function listVoices() {
  const tmp = path.join(WORK, '_v.ps1');
  fs.writeFileSync(tmp, [
    'Add-Type -AssemblyName System.Speech',
    '$s = New-Object System.Speech.Synthesis.SpeechSynthesizer',
    '$s.GetInstalledVoices() | ForEach-Object { $v = $_.VoiceInfo; "$($v.Name)|$($v.Culture)|$($v.Gender)" }',
  ].join('; '), 'utf8');
  try {
    const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', tmp],
      { encoding: 'utf8', timeout: 60000 });
    return out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => {
      const [name, culture, gender] = l.split('|');
      return { name, culture, gender };
    });
  } catch (e) { return []; }
}

/* ---------- 识别器 ---------- */
const sherpa = await import('sherpa-onnx-node');
const { OfflineRecognizer, readWave } = sherpa.default || sherpa;
const recs = {};
function recFor(lang) {
  if (!recs[lang]) {
    recs[lang] = new OfflineRecognizer({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      modelConfig: {
        senseVoice: { model: MODEL, useInverseTextNormalization: 0, language: lang },
        tokens: TOKENS, numThreads: 4, provider: 'cpu', debug: 0,
      },
      decodingMethod: 'greedy_search',
    });
  }
  return recs[lang];
}

const ff = resolveFfmpeg();
function toWav(src) {
  const out = src.replace(/\.wav$/i, '') + '.16k.wav';
  execFileSync(ff, ['-y', '-loglevel', 'error', '-i', src, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', out],
    { stdio: 'pipe', timeout: 120000 });
  return out;
}
function transcribe(wav, lang) {
  const w = readWave(wav);
  const st = recFor(lang).createStream();
  st.acceptWaveform({ samples: w.samples, sampleRate: w.sampleRate });
  recFor(lang).decode(st);
  return recFor(lang).getResult(st).text.trim();
}

/* ============================================================ */
console.log('可用语音:');
const voices = listVoices();
voices.forEach((v) => console.log('  ' + v.name + '  (' + v.culture + ', ' + v.gender + ')'));
const enVoices = voices.filter((v) => /^en/i.test(v.culture || ''));
const zhVoices = voices.filter((v) => /^zh/i.test(v.culture || ''));
console.log('\n英语语音 ' + enVoices.length + ' 个, 中文语音 ' + zhVoices.length + ' 个\n');

/* ---------- 矩阵 ---------- */
const rows = [];

console.log('=== A. 英语：不同语音 + 不同语速 ===');
const enVoice = enVoices[0]?.name;
for (const rate of [-2, 0, 2, 4, 6]) {
  const name = 'en-rate' + rate;
  const wav = path.join(WORK, name + '.wav');
  if (!synth(TEXTS.en, enVoice, rate, wav)) { console.log('  ⏭ rate=' + rate + ' 合成失败'); continue; }
  let text = '';
  try { text = transcribe(toWav(wav), 'en'); } catch (e) { console.log('  ⏭ rate=' + rate + ' 识别失败: ' + e.message); continue; }
  const w = wer(TEXTS.en, text, true);
  rows.push({ group: '英语语速', cond: 'rate=' + rate, rate: w.rate, dist: w.distance, ref: w.refLen, text });
  console.log('  rate=' + String(rate).padStart(2) + '  WER ' + (w.rate * 100).toFixed(1).padStart(5) + '%   ' +
    (w.exact ? '✅ 完全正确' : describeOps(w.ops).slice(0, 70)));
}

console.log('\n=== B. 英语：其它可用语音（口音差异）===');
for (const v of enVoices.slice(1, 4)) {
  const wav = path.join(WORK, 'en-voice-' + v.name.replace(/[^\w]/g, '_') + '.wav');
  if (!synth(TEXTS.en, v.name, 0, wav)) continue;
  let text = '';
  try { text = transcribe(toWav(wav), 'en'); } catch (e) { continue; }
  const w = wer(TEXTS.en, text, true);
  rows.push({ group: '英语口音', cond: v.name + ' (' + v.culture + ')', rate: w.rate, dist: w.distance, ref: w.refLen, text });
  console.log('  ' + v.name.padEnd(28) + ' WER ' + (w.rate * 100).toFixed(1).padStart(5) + '%   ' +
    (w.exact ? '✅' : describeOps(w.ops).slice(0, 60)));
}

console.log('\n=== C. 中文 ===');
const zhVoice = zhVoices[0]?.name;
for (const rate of [-2, 0, 3]) {
  const wav = path.join(WORK, 'zh-rate' + rate + '.wav');
  if (!synth(TEXTS.zh, zhVoice, rate, wav)) { console.log('  ⏭ 合成失败'); continue; }
  let text = '';
  try { text = transcribe(toWav(wav), 'zh'); } catch (e) { console.log('  ⏭ ' + e.message); continue; }
  const w = wer(TEXTS.zh, text, false);
  rows.push({ group: '中文语速', cond: 'rate=' + rate, rate: w.rate, dist: w.distance, ref: w.refLen, text });
  console.log('  rate=' + String(rate).padStart(2) + '  CER ' + (w.rate * 100).toFixed(1).padStart(5) + '%   ' +
    (w.exact ? '✅ 完全正确' : describeOps(w.ops).slice(0, 70)));
}

console.log('\n=== D. 日语 ===');
const jaVoice = voices.find((v) => /^ja/i.test(v.culture || ''))?.name;
if (!jaVoice) {
  console.log('  ⏭ 本机无日语语音，跳过');
} else {
  const wav = path.join(WORK, 'ja.wav');
  if (synth(TEXTS.ja, jaVoice, 0, wav)) {
    try {
      const text = transcribe(toWav(wav), 'ja');
      const w = wer(TEXTS.ja, text, false);
      rows.push({ group: '日语', cond: 'rate=0', rate: w.rate, dist: w.distance, ref: w.refLen, text });
      console.log('  CER ' + (w.rate * 100).toFixed(1) + '%   ' + (w.exact ? '✅' : describeOps(w.ops).slice(0, 70)));
    } catch (e) { console.log('  ⏭ ' + e.message); }
  }
}

console.log('\n=== E. 跨语言误设（用错误语言码识别）===');
{
  const wav = path.join(WORK, 'en-rate0.wav');
  if (fs.existsSync(wav)) {
    const w16 = toWav(wav);
    for (const lang of ['en', 'zh', 'ja', 'auto']) {
      try {
        const text = transcribe(w16, lang);
        const w = wer(TEXTS.en, text, true);
        console.log('  --lang ' + lang.padEnd(5) + ' WER ' + (w.rate * 100).toFixed(1).padStart(5) + '%   ' +
          JSON.stringify(text.slice(0, 55)));
      } catch (e) { console.log('  --lang ' + lang + ' 失败'); }
    }
  }
}

/* ---------- 汇总 ---------- */
console.log('\n' + '='.repeat(64));
console.log('汇总（TTS 合成音，仅供参考趋势；真人录音见 tests/benchmark.js）');
console.log('='.repeat(64));
const byGroup = {};
rows.forEach((r) => { (byGroup[r.group] = byGroup[r.group] || []).push(r); });
for (const [g, list] of Object.entries(byGroup)) {
  const avg = list.reduce((a, r) => a + r.rate, 0) / list.length;
  console.log(g.padEnd(12) + ' 样本 ' + list.length + '  平均错误率 ' + (avg * 100).toFixed(1) + '%  ' +
    list.map((r) => (r.rate * 100).toFixed(0) + '%').join(' / '));
}
const all = rows.reduce((a, r) => ({ d: a.d + r.dist, n: a.n + r.ref }), { d: 0, n: 0 });
console.log('\n合计 ' + all.n + ' 单位，总错误率 ' + (all.d / all.n * 100).toFixed(2) + '%');

fs.writeFileSync(path.join(RESULTS_DIR, 'accuracy-matrix-result.json'), JSON.stringify(rows, null, 2), 'utf8');
console.log('\n明细写入 ' + path.join(RESULTS_DIR, 'accuracy-matrix-result.json'));
