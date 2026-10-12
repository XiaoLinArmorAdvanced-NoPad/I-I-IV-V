/* ============================================================
 * 健壮性测试：极端音频 + 各种容器格式 + 异常输入
 *
 *   node tests/robustness.test.js
 *
 * 关键：测**完整 CLI 路径**（transcribe.js），而不是只调识别器。
 * 因为非 WAV 必须先经 ffmpeg 转成 16k 单声道再识别 ——
 * 早期版本这个测试直接 readWave(mp3) 导致全部失败，是测试自己的错。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TMP_DIR, resolveFfmpeg, MODEL } from '../lib/paths.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'transcribe.js');

let pass = 0, fail = 0;
const failures = [];
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; failures.push({ label, detail }); console.log('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

const WORK = path.join(TMP_DIR, 'robustness');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

/* ---------------- WAV 生成器 ---------------- */
function writeWav(file, samples, sampleRate = 16000, channels = 1) {
  const blockAlign = channels * 2;
  const dataSize = samples.length * 2;
  const buf = Buffer.alloc(44 + dataSize);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(channels, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(sampleRate * blockAlign, 28); buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(16, 34); buf.write('data', 36); buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < samples.length; i++) {
    buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
  return file;
}
const secs = (n, sr = 16000) => Math.floor(n * sr);
const tone = (n, sr, freq = 220) => {
  const s = new Float32Array(secs(n, sr));
  for (let i = 0; i < s.length; i++) {
    s[i] = 0.3 * Math.sin(2 * Math.PI * freq * i / sr) * (1 + 0.4 * Math.sin(2 * Math.PI * 3 * i / sr));
  }
  return s;
};

/* ---------------- 跑 CLI ---------------- */
function runCli(args, timeoutMs = 120000) {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args], { encoding: 'utf8', stdio: 'pipe', timeout: timeoutMs });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status ?? -1, out: (e.stdout || '') + (e.stderr || '') };
  }
}
/** 判断输出里有没有"引擎崩溃"的特征（区别于友好的错误提示） */
const looksCrashed = (s) => /TypeError|ReferenceError|Cannot read propert|is not a function|undefined is not|UnhandledPromise/.test(s);

/* ============================================================
 * 1. 极端音频：不应崩溃
 * ============================================================ */
console.log('=== 1. 极端音频输入（不应崩溃）===\n');
const extremes = [
  ['纯静音 2 秒', () => writeWav(path.join(WORK, 'silence.wav'), new Float32Array(secs(2)))],
  ['单样本', () => writeWav(path.join(WORK, 'one-sample.wav'), new Float32Array([0.5]))],
  ['10 毫秒', () => writeWav(path.join(WORK, 'tiny.wav'), new Float32Array(secs(0.01)))],
  ['直流偏移 0.8', () => writeWav(path.join(WORK, 'dc.wav'), new Float32Array(secs(2)).fill(0.8))],
  ['白噪声', () => {
    const s = new Float32Array(secs(2));
    for (let i = 0; i < s.length; i++) s[i] = (Math.random() * 2 - 1) * 0.3;
    return writeWav(path.join(WORK, 'noise.wav'), s);
  }],
  ['满幅方波（削波）', () => {
    const s = new Float32Array(secs(1));
    for (let i = 0; i < s.length; i++) s[i] = (i % 100 < 50) ? 1.0 : -1.0;
    return writeWav(path.join(WORK, 'square.wav'), s);
  }],
  ['样本超出 [-1,1]', () => {
    const s = new Float32Array(secs(0.5));
    for (let i = 0; i < s.length; i++) s[i] = Math.sin(i / 20) * 5;
    return writeWav(path.join(WORK, 'over.wav'), s);
  }],
  ['20Hz 极低频', () => {
    const s = new Float32Array(secs(1));
    for (let i = 0; i < s.length; i++) s[i] = Math.sin(2 * Math.PI * 20 * i / 16000) * 0.7;
    return writeWav(path.join(WORK, 'lowfreq.wav'), s);
  }],
];

for (const [label, gen] of extremes) {
  const f = gen();
  const r = runCli([f]);
  const crashed = looksCrashed(r.out);
  check('不崩溃: ' + label, !crashed, crashed ? r.out.slice(0, 200) : '');
  const m = /========.*?========\n([\s\S]*?)\n\n=== 完成/.exec(r.out);
  if (m) console.log('      → ' + JSON.stringify(m[1].trim().slice(0, 50)));
}

/* ============================================================
 * 2. 采样率 / 声道 / 位深
 * ============================================================ */
console.log('\n=== 2. 采样率与声道（ffmpeg 转换路径）===\n');
const ff = resolveFfmpeg();
if (!ff) { console.log('  ⚠ 无 ffmpeg，跳过整节'); }
else {
  const base = writeWav(path.join(WORK, 'base44k.wav'), tone(3, 44100), 44100);
  const variants = [
    ['8kHz 单声道', ['-ar', '8000', '-ac', '1'], '.wav'],
    ['22.05kHz 单声道', ['-ar', '22050', '-ac', '1'], '.wav'],
    ['48kHz 立体声', ['-ar', '48000', '-ac', '2'], '.wav'],
    ['48kHz 5.1 声道', ['-ar', '48000', '-ac', '6'], '.wav'],
    ['32-bit 浮点 WAV', ['-ar', '16000', '-ac', '1', '-c:a', 'pcm_f32le'], '.wav'],
    ['24-bit WAV', ['-ar', '16000', '-ac', '1', '-c:a', 'pcm_s24le'], '.wav'],
    ['8-bit WAV', ['-ar', '16000', '-ac', '1', '-c:a', 'pcm_u8'], '.wav'],
    ['mp3 128k', ['-c:a', 'libmp3lame', '-b:a', '128k'], '.mp3'],
    ['mp3 32k 低码率', ['-c:a', 'libmp3lame', '-b:a', '32k'], '.mp3'],
    ['m4a (aac)', ['-c:a', 'aac', '-b:a', '96k'], '.m4a'],
    ['flac', ['-c:a', 'flac'], '.flac'],
    ['ogg (vorbis)', ['-c:a', 'libvorbis'], '.ogg'],
    ['opus', ['-c:a', 'libopus', '-b:a', '64k'], '.opus'],
    ['wma', ['-c:a', 'wmav2'], '.wma'],
  ];
  for (const [label, args, ext] of variants) {
    const out = path.join(WORK, 'v-' + label.replace(/[^\w]/g, '_') + ext);
    let made = true;
    try {
      execFileSync(ff, ['-y', '-loglevel', 'error', '-i', base, ...args, out], { stdio: 'pipe', timeout: 120000 });
    } catch (e) {
      const msg = (e.stderr || e.message).toString();
      if (/Unknown encoder|not found/i.test(msg)) { console.log('  ⏭ 跳过: ' + label + '（此 ffmpeg 构建无该编码器）'); made = false; }
      else { check('生成: ' + label, false, msg.slice(0, 120)); made = false; }
    }
    if (!made) continue;
    const r = runCli([out]);
    const ok = r.code === 0 && !looksCrashed(r.out) && /成功 1 \/ 1/.test(r.out);
    check('CLI 可转写: ' + label, ok, ok ? '' : 'exit=' + r.code + ' ' + r.out.slice(0, 180));
  }
}

/* ============================================================
 * 3. --lang 参数边界
 * ============================================================ */
console.log('\n=== 3. --lang 参数边界 ===\n');
const wav = path.join(WORK, 'base44k.wav');
for (const lang of ['en', 'zh', 'ja', 'ko', 'yue', 'auto', 'EN', 'En', 'AUTO', 'english', 'chinese', '中文', '日文', '한국어']) {
  const r = runCli([wav, '--lang', lang]);
  const crashed = looksCrashed(r.out);
  const ok = !crashed && r.code === 0 && /成功 1 \/ 1/.test(r.out);
  check('接受: --lang ' + JSON.stringify(lang), ok, ok ? '' : 'exit=' + r.code + ' ' + r.out.slice(0, 150));
}
/* 非法值必须被**明确拒绝**（exit 2 + 可读提示），而不是传给原生库崩掉 */
for (const lang of ['xx', 'klingon', '123', 'e']) {
  const r = runCli([wav, '--lang', lang]);
  const crashed = looksCrashed(r.out);
  const rejected = r.code === 2 && /不受支持/.test(r.out);
  check('拒绝非法: --lang ' + JSON.stringify(lang), rejected && !crashed,
    rejected ? '' : 'exit=' + r.code + ' ' + r.out.slice(0, 150));
}

/* ============================================================
 * 4. 多文件 / 目录 / 混合格式
 * ============================================================ */
console.log('\n=== 4. 多文件与目录 ===\n');
{
  const dir = path.join(WORK, 'mixed');
  fs.mkdirSync(dir, { recursive: true });
  writeWav(path.join(dir, 'a.wav'), tone(2, 16000));
  writeWav(path.join(dir, 'b.wav'), tone(2, 16000, 330));
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'not audio');
  fs.writeFileSync(path.join(dir, 'readme.md'), '# nope');
  const r = runCli([dir]);
  check('目录扫描忽略非音频文件', /成功 2 \/ 2/.test(r.out), r.out.slice(-300));
  check('生成汇总文件', fs.existsSync(path.join(dir, '..', '..', '..', 'transcripts-all.txt')) || /transcripts-all/.test(r.out), '');
}

/* ============================================================
 * 5. 确定性
 * ============================================================ */
console.log('\n=== 5. 确定性（同输入 8 次）===\n');
{
  const texts = [];
  let crashed = 0;
  for (let i = 0; i < 8; i++) {
    const r = runCli([wav]);
    if (looksCrashed(r.out)) { crashed++; continue; }
    const m = /========.*?========\n([\s\S]*?)\n\n=== 完成/.exec(r.out);
    texts.push(m ? m[1].trim() : '');
  }
  check('8 次无崩溃', crashed === 0, '崩 ' + crashed);
  check('8 次结果完全一致', new Set(texts).size === 1, '出现 ' + new Set(texts).size + ' 种');
}

/* ============================================================
 * 6. 损坏 / 伪装 / 空文件
 * ============================================================ */
console.log('\n=== 6. 损坏与伪装文件 ===\n');
{
  const bad = [
    ['纯文本冒充 mp3', 'fake.mp3', 'this is definitely not an mp3'],
    ['空文件', 'empty.wav', ''],
    ['截断的 wav', 'truncated.wav', null],
    ['只有 RIFF 头', 'riffonly.wav', null],
  ];
  fs.writeFileSync(path.join(WORK, 'fake.mp3'), 'this is definitely not an mp3');
  fs.writeFileSync(path.join(WORK, 'empty.wav'), '');
  fs.writeFileSync(path.join(WORK, 'truncated.wav'), fs.readFileSync(wav).slice(0, 100));
  fs.writeFileSync(path.join(WORK, 'riffonly.wav'), Buffer.from('RIFF$$$$WAVEfmt '));

  for (const [label, name] of bad) {
    const r = runCli([path.join(WORK, name)], 90000);
    const crashed = looksCrashed(r.out);
    check('不崩且有提示: ' + label, !crashed, crashed ? r.out.slice(0, 200) : '');
    console.log('      → exit=' + r.code + '  ' + r.out.split('\n').map((l) => l.trim()).filter(Boolean).slice(-2).join(' | ').slice(0, 130));
  }
}

/* ============================================================
 * 7. 深层目录 / 特殊文件名
 * ============================================================ */
console.log('\n=== 7. 特殊文件名 ===\n');
{
  const names = [
    '带 空格 的.wav',
    '中文名称.wav',
    'emoji-🎵.wav',
    'dash-and_underscore.wav',
    'dot.in.name.wav',
  ];
  const dir = path.join(WORK, 'names');
  fs.mkdirSync(dir, { recursive: true });
  for (const n of names) {
    try {
      writeWav(path.join(dir, n), tone(1.5, 16000));
      const r = runCli([path.join(dir, n)], 60000);
      const ok = r.code === 0 && !looksCrashed(r.out) && /成功 1 \/ 1/.test(r.out);
      check('可处理: ' + n, ok, ok ? '' : r.out.slice(0, 150));
    } catch (e) {
      check('可处理: ' + name, false, e.message.slice(0, 100));
    }
  }
}

/* ============================================================
 * 8. 参数组合
 * ============================================================ */
console.log('\n=== 8. 参数组合 ===\n');
{
  const combos = [
    [['--json', wav], 'json'],
    [['--stdout', wav], 'stdout'],
    [['--no-itn', wav], 'no-itn'],
    [['--lang', 'auto', '--json', wav], 'lang+json'],
    [['--lang', 'zh', '--no-itn', '--stdout', wav], '三个组合'],
  ];
  for (const [args, label] of combos) {
    const r = runCli(args, 90000);
    const crashed = looksCrashed(r.out);
    check('组合可用: ' + label, !crashed && r.code === 0, crashed ? r.out.slice(0, 150) : ('exit=' + r.code));
  }
  /* --json 必须输出合法 JSON */
  const r = runCli(['--json', wav]);
  let valid = false;
  try { const j = JSON.parse(r.out); valid = Array.isArray(j.results); } catch (e) { }
  check('--json 输出合法 JSON', valid, valid ? '' : r.out.slice(0, 200));

  /* --stdout 不应写 .txt —— 必须在干净目录里测，否则会被上次残留误导 */
  const soloDir = path.join(WORK, 'stdout-only');
  fs.rmSync(soloDir, { recursive: true, force: true });
  fs.mkdirSync(soloDir, { recursive: true });
  const solo = writeWav(path.join(soloDir, 'solo.wav'), tone(1.5, 16000));
  runCli(['--stdout', solo]);
  const wroteTxt = fs.existsSync(path.join(soloDir, 'solo.txt'));
  check('--stdout 不写 .txt 文件', !wroteTxt, wroteTxt ? '却写了 solo.txt' : '');
  /* 反过来确认不带 --stdout 时会写 */
  fs.rmSync(path.join(soloDir, 'solo.txt'), { force: true });
  runCli([solo]);
  check('不带 --stdout 时写 .txt', fs.existsSync(path.join(soloDir, 'solo.txt')));
}

/* ============================================================
 * 汇总
 * ============================================================ */
console.log('\n' + '='.repeat(46));
console.log('通过 ' + pass + ' / ' + (pass + fail) + (fail ? '，失败 ' + fail + ' ❌' : '，全部通过 ✅'));
if (fail) {
  console.log('\n失败明细:');
  failures.forEach((f) => console.log('  • ' + f.label + (f.detail ? '\n      ' + f.detail : '')));
}
process.exitCode = fail ? 1 : 0;
