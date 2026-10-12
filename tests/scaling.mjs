/* ============================================================
 * 耗时与内存随音频长度的变化
 *
 *   node tests/scaling.mjs
 *
 * 用途：验证 docs/ACCURACY-zh.md 第 8 节里的内存与耗时数字。
 *       这些是"长音频自动分块"这个特性存在的理由，必须可复现。
 *
 * ⚠️ 这是**测量工具**，不是通过/失败的测试 —— 绝对数字会随机器负载、
 *    热状态、线程调度明显波动（实测同一 300s 用例出现过 25s 和 49s 两种结果）。
 *    所以它不接入 CI。要判断分块是否正确，请跑 tests/vad.test.js（有明确断言）。
 *
 * 说明：本机没有长音频语音素材，这里用调幅正弦合成。
 *       模型对纯音会输出空文本，但**内存与耗时的度量仍然有效** ——
 *       这条路径的开销在特征提取与解码，不取决于内容是否可识别。
 *
 * 已知夹具局限：用「整个 WAV 逐份拼接」造长音频时，拼接处会产生识别垃圾
 * （源文件末句与下一份首段静音几乎无间隔，模型在边界丢词）。
 * 真实素材有自然停顿，不具此问题。本文件的分块解码用内存切片，绕过该问题。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TMP_DIR, resolveFfmpeg } from '../lib/paths.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'transcribe.js');
const WORK = path.join(TMP_DIR, 'scaling');
const RESULTS = path.join(TMP_DIR, 'results');
fs.rmSync(WORK, { recursive: true, force: true });
fs.mkdirSync(WORK, { recursive: true });
fs.mkdirSync(RESULTS, { recursive: true });

function writeWav(file, seconds, sr = 16000) {
  const n = Math.floor(seconds * sr);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write('WAVE', 8);
  buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sr, 24); buf.writeUInt32LE(sr * 2, 28);
  buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const v = Math.round(0.3 * Math.sin(2 * Math.PI * 200 * t) * (1 + 0.5 * Math.sin(2 * Math.PI * 2 * t)) * 32767);
    buf.writeInt16LE(v, 44 + i * 2);
  }
  fs.writeFileSync(file, buf);
  return file;
}

/** 跑 CLI 并采样峰值内存 */
async function measure(file, extraArgs = []) {
  const t0 = Date.now();
  const p = spawn(process.execPath, [CLI, file, '--stdout', ...extraArgs], { stdio: ['ignore', 'pipe', 'pipe'] });
  let peakMB = 0;
  const sample = () => {
    try {
      let kb = 0;
      if (process.platform === 'win32') {
        const out = execFileSync('tasklist', ['/FI', 'PID eq ' + p.pid, '/FO', 'CSV', '/NH'],
          { encoding: 'utf8', timeout: 10000 });
        const m = out.match(/"([\d,]+) K"/);
        if (m) kb = parseInt(m[1].replace(/,/g, ''), 10);
      } else {
        const st = fs.readFileSync('/proc/' + p.pid + '/status', 'utf8');
        const m = st.match(/VmRSS:\s+(\d+) kB/);
        if (m) kb = parseInt(m[1], 10);
      }
      if (kb > 0) peakMB = Math.max(peakMB, kb / 1024);
    } catch (e) { /* 进程已退出 */ }
  };
  const timer = setInterval(sample, 200);
  sample();
  const code = await new Promise((res) => p.on('exit', (c) => res(c)));
  clearInterval(timer);
  return { el: (Date.now() - t0) / 1000, peakMB, code };
}

function chunkCount(file) {
  try {
    const o = execFileSync(process.execPath, [CLI, file, '--json'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 900000 });
    const r = JSON.parse(o).results[0];
    return { chunks: r.chunks ?? 1, method: r.chunkMethod || '?' };
  } catch (e) { return { chunks: 1, method: 'err' }; }
}

console.log('=== 耗时与内存随音频长度变化 ===\n');
console.log('（16k 单声道 wav，默认参数 = 超过 300s 自动 VAD 分块）\n');
console.log('音频长度    文件大小   耗时      倍率      峰值内存     分块');
console.log('-'.repeat(66));

const rows = [];
for (const sec of [10, 30, 60, 120, 300, 600]) {
  const f = writeWav(path.join(WORK, 'len' + sec + '.wav'), sec);
  const sizeMB = fs.statSync(f).size / 1048576;
  const r = await measure(f);
  const c = chunkCount(f);
  rows.push({ sec, sizeMB, el: r.el, ratio: sec / r.el, peakMB: r.peakMB, chunks: c.chunks, method: c.method, code: r.code });
  console.log(
    String(sec + 's').padEnd(12) +
    (sizeMB.toFixed(1) + ' MB').padEnd(11) +
    (r.el.toFixed(1) + 's').padEnd(10) +
    ((sec / r.el).toFixed(1) + '×').padEnd(10) +
    (r.peakMB.toFixed(0) + ' MB').padEnd(13) +
    c.chunks + (c.chunks > 1 ? ' (' + c.method + ')' : '')
  );
}

const get = (s) => rows.find((r) => r.sec === s);
console.log('\n=== 与文档对照（分块前 → 现在）===\n');
for (const [sec, docMem, docEl] of [[60, 519, 2.2], [300, 1700, 25], [600, 5436, 94]]) {
  const r = get(sec);
  if (!r) continue;
  console.log('  ' + String(sec + 's').padEnd(7) + docMem + ' MB / ' + docEl + 's' +
    '   →   ' + r.peakMB.toFixed(0) + ' MB / ' + r.el.toFixed(1) + 's' +
    (r.chunks > 1 ? '   (分 ' + r.chunks + ' 块)' : '   (未分块)'));
}
const big = get(600);
if (big) {
  console.log('\n  600s 内存: 5436 → ' + big.peakMB.toFixed(0) + ' MB  (降到 ' + (big.peakMB / 5436).toFixed(2) + ')');
  console.log('  600s 耗时: 94 → ' + big.el.toFixed(1) + 's  (快 ' + (94 / big.el).toFixed(1) + ' 倍)');
}

const ff = resolveFfmpeg();
if (ff) {
  console.log('\n=== mp3 路径的额外开销 ===\n');
  const wav = writeWav(path.join(WORK, 'cmp120.wav'), 120);
  const mp3 = path.join(WORK, 'cmp120.mp3');
  execFileSync(ff, ['-y', '-loglevel', 'error', '-i', wav, '-c:a', 'libmp3lame', '-b:a', '128k', mp3], { stdio: 'pipe', timeout: 120000 });
  const rw = await measure(wav);
  const rm = await measure(mp3);
  console.log('  wav 直读:  ' + rw.el.toFixed(1) + 's  峰值 ' + rw.peakMB.toFixed(0) + ' MB');
  console.log('  mp3 转码:  ' + rm.el.toFixed(1) + 's  峰值 ' + rm.peakMB.toFixed(0) + ' MB');
  console.log('  额外开销:  ' + (rm.el - rw.el).toFixed(1) + 's（ffmpeg 解码 + 重采样）');
}

console.log('\n=== 对照：强制整段识别（--chunk-threshold 99999）===\n');
{
  const f = path.join(WORK, 'len600.wav');
  if (fs.existsSync(f)) {
    const r = await measure(f, ['--chunk-threshold', '99999']);
    const chunked = get(600);
    console.log('  600s 整段:  ' + r.el.toFixed(1) + 's  峰值 ' + r.peakMB.toFixed(0) + ' MB');
    console.log('  600s 分块:  ' + chunked.el.toFixed(1) + 's  峰值 ' + chunked.peakMB.toFixed(0) + ' MB');
    console.log('  → 分块省 ' + (r.peakMB - chunked.peakMB).toFixed(0) + ' MB，快 ' + (r.el / chunked.el).toFixed(1) + ' 倍');
  }
}

fs.writeFileSync(path.join(RESULTS, 'scaling-result.json'), JSON.stringify(rows, null, 2), 'utf8');
console.log('\n明细写入 ' + path.join(RESULTS, 'scaling-result.json'));
process.exitCode = rows.some((r) => r.code !== 0) ? 1 : 0;
