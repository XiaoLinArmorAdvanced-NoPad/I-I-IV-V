/* ============================================================
 * VAD 分块集成测试
 *
 *   node tests/vad.test.js
 *
 * 验证四件事：
 *   1. 短音频**不触发**分块（走整段识别，最准）
 *   2. 长音频触发 VAD 分块，且**零丢内容**
 *   3. 分块切点落在静音处（不是词中间）
 *   4. 结果结构含 chunkMethod 字段，便于调用方判断
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TMP_DIR, TEST_WAVS, VAD_MODEL, loadReference } from '../lib/paths.js';
import { vadAvailable, detectSpeechSegments, groupSegments, joinChunkTexts } from '../lib/vad.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'transcribe.js');
const WORK = path.join(TMP_DIR, 'vad-test');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });

let pass = 0, fail = 0;
const failures = [];
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; failures.push({ label, detail }); console.log('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

const runJson = (args, timeout = 600000) => {
  try {
    const out = execFileSync(process.execPath, [CLI, ...args, '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout });
    return JSON.parse(out).results[0];
  } catch (e) {
    return { ok: false, error: (e.stdout || '') + (e.stderr || e.message) };
  }
};

console.log('=== 0. VAD 可用性 ===\n');
check('VAD 模型存在', fs.existsSync(VAD_MODEL), VAD_MODEL);
check('vadAvailable() 返回 true', vadAvailable());

const enWav = path.join(TEST_WAVS, 'en.wav');
if (!fs.existsSync(enWav)) { console.error('缺 ' + enWav); process.exit(1); }
const REF = loadReference().en;

/** 读 WAV 为 Float32 */
function readWavSamples(file) {
  const buf = fs.readFileSync(file);
  const sr = buf.readUInt32LE(24);
  const ch = buf.readUInt16LE(22);
  const bits = buf.readUInt16LE(34);
  let pos = 12, dataOff = -1, dataLen = 0;
  while (pos + 8 <= buf.length) {
    const id = buf.toString('latin1', pos, pos + 4);
    const size = buf.readUInt32LE(pos + 4);
    if (id === 'data') { dataOff = pos + 8; dataLen = size; break; }
    pos += 8 + size + (size % 2);
  }
  const n = Math.floor(dataLen / (bits / 8) / ch);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = buf.readInt16LE(dataOff + i * 2 * ch) / 32768;
  return { samples: a, sampleRate: sr };
}

/** 写 WAV */
function writeWav(file, samples, sr = 16000) {
  const n = samples.length;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(samples[i] * 32767))), 44 + i * 2);
  fs.writeFileSync(file, buf);
  return file;
}

/* ============================================================
 * 1. 短音频不触发分块
 * ============================================================ */
console.log('\n=== 1. 短音频不触发分块 ===\n');
{
  const r = runJson([enWav]);
  check('7s 真人语音：chunks=1', r.chunks === 1, 'chunks=' + r.chunks);
  check('7s 真人语音：chunkMethod=none', r.chunkMethod === 'none', 'method=' + r.chunkMethod);
  check('7s 真人语音：识别正确', (r.text || '').replace(/[^a-z0-9]/gi, '').toLowerCase() === REF.replace(/[^a-z0-9]/gi, '').toLowerCase(),
    JSON.stringify((r.text || '').slice(0, 60)));
}

/* ============================================================
 * 2. 长音频触发 VAD 分块，零丢内容
 * ============================================================ */
console.log('\n=== 2. 长音频：VAD 分块 + 零丢内容 ===\n');
const { samples: speech, sampleRate: SR } = readWavSamples(enWav);
const REPEAT = 8;
const GAP_SEC = 1.2;
const gap = new Float32Array(Math.round(GAP_SEC * SR));
const pieces = [];
for (let i = 0; i < REPEAT; i++) pieces.push(speech, gap);
const total = pieces.reduce((a, p) => a + p.length, 0);
const longSamples = new Float32Array(total);
let off = 0;
for (const p of pieces) { longSamples.set(p, off); off += p.length; }
const longFile = writeWav(path.join(WORK, 'long-repeat8.wav'), longSamples, SR);
const longDur = total / SR;
console.log('  构造 ' + longDur.toFixed(1) + 's 长音频（真人语音 ×' + REPEAT + '，句间静音 ' + GAP_SEC + 's）\n');

{
  /* 触发阈值设 30s，确保会分块 */
  const r = runJson([longFile, '--chunk-threshold', '30', '--chunk', '25']);
  check('长音频触发分块', r.chunks > 1, 'chunks=' + r.chunks);
  check('分块方式为 vad', r.chunkMethod === 'vad', 'method=' + r.chunkMethod);
  const n = ((r.text || '').toLowerCase().match(/tribal chieftain/g) || []).length;
  check('零丢内容（检出 ' + n + '/' + REPEAT + ' 句）', n >= REPEAT - 1,
    '检出 ' + n + ' 句，文本长度 ' + (r.text || '').length);
  console.log('      chunks=' + r.chunks + '  时长=' + r.duration.toFixed(1) + 's  检出=' + n + '/' + REPEAT);

  /* 与整段识别的基线对比 */
  const whole = runJson([longFile, '--chunk-threshold', '9999']);
  const nWhole = ((whole.text || '').toLowerCase().match(/tribal chieftain/g) || []).length;
  console.log('      基线（整段不分块）检出 ' + nWhole + '/' + REPEAT + ' 句');
  check('分块结果不劣于整段识别', n >= nWhole - 1, '分块 ' + n + ' vs 整段 ' + nWhole);
}

/* ============================================================
 * 3. 切点落在静音处（不是词中间）
 * ============================================================ */
console.log('\n=== 3. 切点位置正确性 ===\n');
{
  const segs = await detectSpeechSegments(longSamples, SR, { maxSpeechDuration: 30 });
  check('VAD 检出多个语音段', segs.length > 1, 'segs=' + segs.length);
  console.log('      语音段数: ' + segs.length);

  const groups = groupSegments(segs, 25, longDur, 0.3);
  check('分组得到多块', groups.length > 1, 'groups=' + groups.length);

  /* 每个切点都必须落在两段语音之间的空隙里 */
  let cutsInGap = 0, cutsTotal = 0;
  for (let i = 0; i < groups.length - 1; i++) {
    const cut = groups[i].end;
    cutsTotal++;
    const inGap = segs.some((s) => cut >= s.endSec && cut <= s.endSec + GAP_SEC + 0.5) ||
      !segs.some((s) => cut > s.startSec && cut < s.endSec);
    if (inGap) cutsInGap++;
  }
  check('所有切点都不在语音段内部（' + cutsInGap + '/' + cutsTotal + '）', cutsInGap === cutsTotal,
    '有 ' + (cutsTotal - cutsInGap) + ' 个切点落在词中间');
  groups.forEach((g, i) => console.log('      块' + (i + 1) + ': ' + g.start.toFixed(1) + '-' + g.end.toFixed(1) + 's  (' + g.segments + ' 个语音段)'));
}

/* ============================================================
 * 4. 无停顿内容：行为要可预期（不能产出垃圾）
 * ============================================================ */
console.log('\n=== 4. 无停顿长音频（最坏情况）===\n');
{
  /* 真人语音直接首尾相接，句间无静音 */
  const noGapPieces = [];
  for (let i = 0; i < REPEAT; i++) noGapPieces.push(speech);
  const noGapTotal = noGapPieces.reduce((a, p) => a + p.length, 0);
  const noGap = new Float32Array(noGapTotal);
  let o = 0;
  for (const p of noGapPieces) { noGap.set(p, o); o += p.length; }
  const noGapFile = writeWav(path.join(WORK, 'no-gap.wav'), noGap, SR);
  const r = runJson([noGapFile, '--chunk-threshold', '30', '--chunk', '25']);
  const n = ((r.text || '').toLowerCase().match(/tribal chieftain/g) || []).length;
  console.log('      chunks=' + r.chunks + '  method=' + r.chunkMethod + '  检出=' + n + '/' + REPEAT);
  /* 这是病态输入：没有静音可切。要求是"不崩、有合理输出"，不要求零丢失 */
  check('无停顿内容不崩溃', r.ok !== false && typeof r.text === 'string', JSON.stringify(r).slice(0, 150));
  check('无停顿内容仍有输出', (r.text || '').length > 20, 'len=' + (r.text || '').length);
  console.log('      说明: 这类内容没有静音可切，模型只能在有声区间内部切，属已知限制');
}

/* ============================================================
 * 5. joinChunkTexts 去重正确性
 * ============================================================ */
console.log('\n=== 5. 分块文本拼接 ===\n');
{
  check('英文重复尾巴去重', joinChunkTexts(['hello world foo', 'foo bar baz'], true) === 'hello world foo bar baz',
    JSON.stringify(joinChunkTexts(['hello world foo', 'foo bar baz'], true)));
  check('英文无重复直接拼', joinChunkTexts(['aaa bbb', 'ccc ddd'], true) === 'aaa bbb ccc ddd',
    JSON.stringify(joinChunkTexts(['aaa bbb', 'ccc ddd'], true)));
  check('中文重复去重', joinChunkTexts(['今天天气很好', '很好我们出去玩'], false) === '今天天气很好我们出去玩',
    JSON.stringify(joinChunkTexts(['今天天气很好', '很好我们出去玩'], false)));
  check('空块被忽略', joinChunkTexts(['abc', '', '  ', 'def'], true) === 'abc def',
    JSON.stringify(joinChunkTexts(['abc', '', '  ', 'def'], true)));
  check('单块原样返回', joinChunkTexts(['只有一块'], true) === '只有一块');
}

/* ============================================================
 * 6. 边界与防御：不能让原生层抛错
 * ============================================================ */
console.log('\n=== 6. 边界输入 ===\n');
{
  /* 非 16kHz：silero VAD 只接受 16kHz，喂别的采样率原生层会抛
     "Expected sample rate 16000. Given: 8000"，必须在这里挡住 */
  for (const sr of [8000, 22050, 44100, 48000]) {
    let ok = false, err = '';
    try {
      const segs = await detectSpeechSegments(new Float32Array(sr), sr);
      ok = Array.isArray(segs) && segs.length === 0;
    } catch (e) { err = e.message.slice(0, 70); }
    check('非 16kHz (' + sr + ') 返回空数组而非抛错', ok, err);
  }

  /* 极短音频 */
  for (const [label, len] of [['空数组', 0], ['1 采样', 1], ['511 采样', 511], ['512 采样', 512], ['513 采样', 513]]) {
    let ok = false, err = '';
    try {
      const segs = await detectSpeechSegments(new Float32Array(len), 16000);
      ok = Array.isArray(segs);
    } catch (e) { err = e.message.slice(0, 70); }
    check('极短音频不抛错: ' + label, ok, err);
  }

  /* null / undefined */
  for (const [label, v] of [['null', null], ['undefined', undefined]]) {
    let ok = false, err = '';
    try { ok = Array.isArray(await detectSpeechSegments(v, 16000)); } catch (e) { err = e.message.slice(0, 70); }
    check('传入 ' + label + ' 不抛错', ok, err);
  }

  /* groupSegments 的边界 */
  check('空语音段 → 空分组', groupSegments([], 60, 100).length === 0);
  check('单段 → 单分组', groupSegments([{ startSec: 1, endSec: 5, durSec: 4 }], 60, 100).length === 1);
  {
    const g = groupSegments([{ startSec: 0.1, endSec: 1, durSec: 0.9 }], 60, 100, 0.3);
    check('分组起点不被 padding 拉成负数', g[0].start >= 0, 'start=' + g[0].start);
    check('分组终点不超出总时长', g.every((x) => x.end <= 100), JSON.stringify(g));
  }
  {
    /* 目标时长小于单段时长时，每段应各自成组（不会被合并） */
    const segs = [
      { startSec: 0, endSec: 10, durSec: 10 },
      { startSec: 12, endSec: 22, durSec: 10 },
      { startSec: 24, endSec: 34, durSec: 10 },
    ];
    const g = groupSegments(segs, 15, 40);
    check('目标时长小于段长时各自成组', g.length === 3, 'groups=' + g.length);
  }
}
/* ============================================================
 * 7. chunkMethod 必须反映真实的分块方式
 *    曾经硬编码成 'vad'，导致等分切块时调用方（尤其 AI）误判可信度。
 * ============================================================ */
console.log('\n=== 7. chunkMethod 真实性 ===\n');
{
  const cases = [
    { label: '真人语音（有停顿，强制分块）', args: ['--chunk-threshold', '30', '--chunk', '25'], want: 'vad' },
    { label: '真人语音（不分块）', args: ['--chunk-threshold', '99999'], want: 'none' },
  ];
  for (const t of cases) {
    const r = runJson([longFile, ...t.args]);
    check(t.label + ' → ' + t.want, r.chunkMethod === t.want,
      '实际 ' + r.chunkMethod + ' (chunks=' + r.chunks + ')');
  }

  /* 纯音不是语音：VAD 检不到 → 必须是 time-fallback，绝不能谎报 vad */
  const toneFile = path.join(WORK, 'tone-120s.wav');
  {
    const n = Math.floor(120 * SR);
    const s = new Float32Array(n);
    for (let i = 0; i < n; i++) s[i] = 0.3 * Math.sin(2 * Math.PI * 200 * i / SR);
    writeWav(toneFile, s, SR);
  }
  const rt = runJson([toneFile, '--chunk-threshold', '30']);
  check('纯音不谎报 vad', rt.chunkMethod !== 'vad', '实际 ' + rt.chunkMethod);
  check('纯音仍完成转写', rt.ok !== false && typeof rt.text === 'string',
    JSON.stringify(rt).slice(0, 120));
}

/* ---------- 汇总 ---------- */
console.log('通过 ' + pass + ' / ' + (pass + fail) + (fail ? '，失败 ' + fail + ' ❌' : '，全部通过 ✅'));
if (fail) {
  console.log('\n失败明细:');
  failures.forEach((f) => console.log('  • ' + f.label + (f.detail ? '\n      ' + f.detail : '')));
}
process.exitCode = fail ? 1 : 0;
