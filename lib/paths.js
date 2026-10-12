/* ============================================================
 * 路径解析与依赖检查（跨平台）
 *
 * 所有脚本共用。不做任何平台硬编码：sherpa-onnx 与 ffmpeg 的原生二进制
 * 都由 npm 的 optionalDependencies 按平台自动安装。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/** 项目根目录 */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const MODELS_DIR = path.join(ROOT, 'models');
export const MODEL_NAME = 'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17';
export const MODEL_DIR = path.join(MODELS_DIR, MODEL_NAME);
export const MODEL = path.join(MODEL_DIR, 'model.int8.onnx');
export const TOKENS = path.join(MODEL_DIR, 'tokens.txt');
/** tokens.txt 随模型包一起分发，不随仓库提供 */
export const TEST_WAVS = path.join(MODEL_DIR, 'test_wavs');

export const CACHE_DIR = path.join(ROOT, '.cache');
export const TMP_DIR = path.join(os.tmpdir(), 'asr-local');

/** 模型官方校验值（与 DSH 官方语音插件的 assets.json 一致） */
export const MODEL_SHA256 = 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51';
export const TOKENS_SHA256 = 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc';
export const MODEL_BYTES = 239233841;

export const AUDIO_RE = /\.(mp3|wav|m4a|flac|ogg|aac|opus|wma|mp4|m4b|amr)$/i;

/**
 * 解析 ffmpeg 可执行文件路径（跨平台）。
 * 优先读 @ffmpeg-installer/ffmpeg 导出的 path；失败则手工探测。
 * 允许用 FFMPEG_PATH 环境变量覆盖（例如系统已装 ffmpeg）。
 */
export function resolveFfmpeg() {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) return process.env.FFMPEG_PATH;

  try {
    const inst = require('@ffmpeg-installer/ffmpeg');
    if (inst && inst.path && fs.existsSync(inst.path)) return inst.path;
  } catch (e) { /* 未安装，继续探测 */ }

  const bin = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
  const dirs = fs.existsSync(path.join(ROOT, 'node_modules', '@ffmpeg-installer'))
    ? fs.readdirSync(path.join(ROOT, 'node_modules', '@ffmpeg-installer'))
    : [];
  for (const d of dirs) {
    const p = path.join(ROOT, 'node_modules', '@ffmpeg-installer', d, bin);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/** 检查运行环境，返回问题列表（空数组 = 一切就绪） */
export function checkDeps({ needFfmpeg = false } = {}) {
  const problems = [];

  if (!fs.existsSync(MODEL)) {
    problems.push({
      what: '识别模型',
      path: MODEL,
      fix: 'node setup/download-model.js',
    });
  }
  if (!fs.existsSync(TOKENS)) {
    problems.push({
      what: 'tokens.txt',
      path: TOKENS,
      fix: 'node setup/download-model.js',
    });
  }
  try {
    require.resolve('sherpa-onnx-node');
  } catch (e) {
    problems.push({
      what: 'sherpa-onnx-node',
      path: 'node_modules/sherpa-onnx-node',
      fix: 'npm install',
    });
  }
  if (needFfmpeg && !resolveFfmpeg()) {
    problems.push({
      what: 'ffmpeg（非 wav 格式需要）',
      path: 'node_modules/@ffmpeg-installer',
      fix: 'npm install  （或设置 FFMPEG_PATH 指向系统 ffmpeg）',
    });
  }
  return problems;
}

/** 统一的问题打印 */
export function reportProblems(problems) {
  if (!problems.length) return false;
  console.error('❌ 运行环境不完整：\n');
  for (const p of problems) {
    console.error('   [' + p.what + ']');
    console.error('     路径: ' + p.path);
    console.error('     修复: ' + p.fix + '\n');
  }
  return true;
}

/**
 * 把输入（文件/目录）展开成音频文件列表。
 *
 * 不存在的输入会被记进 `missing`，而不是静默丢弃 —— 否则 `transcribe.js 打错的路径`
 * 会变成"什么都没做但退出码 0"，脚本调用方会误以为成功。
 */
export function collectTargets(inputs) {
  const out = [];
  const missing = [];
  for (const inp of inputs) {
    if (!fs.existsSync(inp)) { missing.push(inp); continue; }
    if (fs.statSync(inp).isDirectory()) {
      out.push(...fs.readdirSync(inp)
        .filter((f) => AUDIO_RE.test(f))
        .sort()
        .map((f) => path.join(inp, f)));
    } else out.push(inp);
  }
  return Object.assign(out, { missing });
}

/** 按宽度折行 */
export function wrap(text, width = 110) {
  const lines = [];
  for (let i = 0; i < text.length; i += width) lines.push(text.slice(i, i + width));
  return lines.join('\n');
}

export { require };
