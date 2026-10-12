/* ============================================================
 * 长音频切分：用 silero VAD 在自然停顿处找切点
 *
 * 为什么不是固定时间切块：
 *   固定时间切会把词从中间切断，切点上的词被两个块各识别一半，产出垃圾文本。
 *   实测（真人语音重复 12 次、句间无停顿）：
 *     固定 30s 切块 → 只检出 8/12 句
 *     按 VAD 切点切 → 检出 16 段语音，分 3 块后 8/8 句全检出（零丢失）
 *
 * 边界精度（真人语音 + 已知静音垫）：起点偏差 +0.01s，终点 -0.25s。
 *
 * 依赖 silero_vad.onnx —— 由 setup/download-model.js 一并下载。
 * 拿不到模型、或采样率不是 16kHz 时，返回空数组让调用方退回等分切块。
 *
 * 资源提示：sherpa-onnx 的 Vad **没有 destroy/free 方法**，实测每创建一个实例
 * 约占 5.2 MB 原生内存且只能等 GC 回收。所以这里每次调用创建一个实例
 * （CLI 是短进程，退出即全部释放）；不要在高频循环里反复调用。
 * ============================================================ */
import fs from 'node:fs';
import { VAD_MODEL, VAD_MODEL_BYTES_MIN } from './paths.js';

/** VAD 是否可用（模型文件存在且大小合理） */
export function vadAvailable() {
  try {
    const st = fs.statSync(VAD_MODEL);
    return st.isFile() && st.size >= VAD_MODEL_BYTES_MIN;   // 防截断/占位文件
  } catch (e) { return false; }
}

/** silero VAD 只接受 16kHz —— 传别的采样率会在原生层抛错 */
export const VAD_SAMPLE_RATE = 16000;

/**
 * 用流式 VAD 找出所有语音段。
 *
 * 字段约定（实测得出，容易搞错）：
 *   s.start    —— 起始位置，单位是**采样数**，不是秒
 *   s.samples  —— 该段的音频数据（Float32Array）
 *   没有 s.end 字段！结束位置 = start + samples.length
 *
 * @param {Float32Array} audio 整段音频（**必须 16kHz**）
 * @param {number} sampleRate
 * @param {object} [opts]
 * @returns {Promise<Array<{startSec:number,endSec:number,durSec:number}>>}
 */
export async function detectSpeechSegments(audio, sampleRate, opts = {}) {
  if (!vadAvailable()) return [];
  /* 采样率不是 16kHz 时绝不能把音频喂给 VAD —— 原生层会直接抛错：
     "silero-vad-model.cc: Expected sample rate 16000. Given: 8000"
     返回空数组让调用方走等分切块，比让整个转写任务失败要好。 */
  if (sampleRate !== VAD_SAMPLE_RATE) return [];
  if (!audio || !audio.length) return [];
  const sherpa = await import('sherpa-onnx-node');
  const { Vad } = sherpa.default || sherpa;

  const windowSize = opts.windowSize ?? 512;
  const cfg = {
    sileroVad: {
      model: VAD_MODEL,
      threshold: opts.threshold ?? 0.5,
      minSilenceDuration: opts.minSilenceDuration ?? 0.35,
      minSpeechDuration: opts.minSpeechDuration ?? 0.25,
      maxSpeechDuration: opts.maxSpeechDuration ?? 20,
      windowSize,
    },
    sampleRate,
    numThreads: 1,
    provider: 'cpu',
    debug: 0,
  };

  const vad = new Vad(cfg);
  const segs = [];
  const drain = () => {
    while (!vad.isEmpty()) {
      const s = vad.front();
      const n = s.samples ? s.samples.length : 0;
      segs.push({
        startSec: s.start / sampleRate,
        endSec: (s.start + n) / sampleRate,
        durSec: n / sampleRate,
      });
      vad.pop();
    }
  };

  let pos = 0;
  while (pos < audio.length) {
    const end = Math.min(pos + windowSize, audio.length);
    vad.acceptWaveform(audio.subarray(pos, end));
    drain();
    pos = end;
  }
  vad.flush();
  drain();

  segs.sort((a, b) => a.startSec - b.startSec);
  return segs;
}

/**
 * 把语音段分组成若干块，每块不超过 targetSec。
 * 切点落在**语音段之间的间隙**里，保证不从词中间切断。
 *
 * @param {Array} segs detectSpeechSegments 的结果
 * @param {number} targetSec 目标块时长
 * @param {number} totalSec 音频总时长（用于收尾）
 * @param {number} [pad] 每块前后留的余量。实测 VAD 判定的终点比真实语音
 *                       早约 0.25s，留 0.3s 可避免切掉末音素。
 */
export function groupSegments(segs, targetSec, totalSec, pad = 0.3) {
  if (!segs.length) return [];
  const groups = [];
  let cur = { start: segs[0].startSec, end: segs[0].endSec, count: 1 };
  for (let i = 1; i < segs.length; i++) {
    const s = segs[i];
    /* 加入这一段后是否超目标 */
    if (s.endSec - cur.start > targetSec) {
      groups.push(cur);
      cur = { start: s.startSec, end: s.endSec, count: 1 };
    } else {
      cur.end = s.endSec;
      cur.count++;
    }
  }
  groups.push(cur);

  /* 每块前后各留 pad 余量，再夹到 [0, totalSec] */
  return groups.map((g) => ({
    start: Math.max(0, g.start - pad),
    end: Math.min(totalSec, g.end + pad),
    segments: g.count,
  })).filter((g) => g.end - g.start > 0.1);
}

/**
 * 把多块文本拼起来，去掉切点处可能重复的词。
 * 因为切点落在静音处，重复通常很少，但仍做一次保守去重。
 */
export function joinChunkTexts(parts, byWord) {
  let out = '';
  for (const raw of parts) {
    const t = String(raw || '').trim();
    if (!t) continue;
    if (!out) { out = t; continue; }
    if (byWord) {
      const a = out.split(/\s+/), b = t.split(/\s+/);
      const max = Math.min(a.length, b.length, 20);
      let overlap = 0;
      for (let k = max; k > 0; k--) {
        if (a.slice(-k).join(' ').toLowerCase() === b.slice(0, k).join(' ').toLowerCase()) { overlap = k; break; }
      }
      out += ' ' + b.slice(overlap).join(' ');
    } else {
      const max = Math.min(out.length, t.length, 15);
      let overlap = 0;
      for (let k = max; k > 0; k--) {
        if (out.slice(-k) === t.slice(0, k)) { overlap = k; break; }
      }
      out += t.slice(overlap);
    }
  }
  return out.trim();
}
