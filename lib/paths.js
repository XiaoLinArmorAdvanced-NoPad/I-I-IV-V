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
/** 模型自带样例音频目录（纯 wav 随模型包分发，参考答案见 sensevoice-reference.json） */
export const TEST_WAVS = path.join(MODEL_DIR, 'test_wavs');

export const CACHE_DIR = path.join(ROOT, '.cache');
export const TMP_DIR = path.join(os.tmpdir(), 'asr-local');

/**
 * silero VAD 模型路径。
 *
 * 用途：长音频分块时找**自然停顿**作为切点。固定时间切块会把词切断，
 * 实测只检出 8/12 句；按 VAD 切点切则零丢失。
 *
 * 注意：这个文件的官方校验值在 DSH 语音插件的 assets.json 里记录为
 * a35ebf52fd3ce5f1469b2a36158dba761bc47b973ea3382b3186ca15b1f5af28 (1807522 字节)，
 * 但 k2-fsa release 上现在能拿到的 asr-models/silero_vad.onnx 是
 * 9e2449e1087496d8d4caba907f23e0bd3f78d91fa552479bb9c23ac09cbb1fd6 (643854 字节)，
 * **两者不同**（版本差异）。所以这里不强校验 SHA256，只校验能加载且能正常分段。
 */
export const VAD_MODEL = path.join(MODELS_DIR, 'silero_vad.onnx');
export const VAD_MODEL_BYTES_MIN = 100000;   // 合理下限，防截断文件

/** 模型官方校验值（与 DSH 官方语音插件的 assets.json 一致） */
export const MODEL_SHA256 = 'c71f0ce00bec95b07744e116345e33d8cbbe08cef896382cf907bf4b51a2cd51';
export const TOKENS_SHA256 = 'f449eb28dc567533d7fa59be34e2abca8784f771850c78a47fb731a31429a1dc';

export const AUDIO_RE = /\.(mp3|wav|m4a|flac|ogg|aac|opus|wma|mp4|m4b|amr)$/i;

/**
 * 模型自带样例音频的**官方参考文本**（真值）。
 *
 * 为什么从仓库里读而不是从模型目录读：k2-fsa 的 release tar 包**只含 .wav，不含 .txt**，
 * 所以全新解包后模型目录里没有参考答案。早期版本直接读 `test_wavs/<lang>.txt`，
 * 结果 CI 上找不到文件 → 基准测试静默跳过 → 还报"全部通过"（假绿）。
 * 现在真值随仓库分发，不再依赖模型包内容。
 */
export const REFERENCE_FILE = path.join(ROOT, 'lib', 'sensevoice-reference.json');

/** 加载参考文本，返回 { en: '...', zh: '...', ... }（过滤掉 _comment 等下划线开头的键） */
export function loadReference() {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(REFERENCE_FILE, 'utf8'));
  } catch (e) {
    return { error: '无法读取 ' + REFERENCE_FILE + ': ' + e.message };
  }
  const out = {};
  for (const [k, v] of Object.entries(data)) {
    if (k.startsWith('_')) continue;
    if (typeof v === 'string' && v.trim()) out[k] = v.trim();
  }
  return out;
}

/** 参考文本支持的语种列表（顺序固定，便于输出对齐） */
export const REF_LANGS = ['en', 'zh', 'ja', 'ko', 'yue'];

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

/**
 * 检查某条命令在 PATH 里是否存在（用于给出准确的修复命令）
 */
function hasCommand(cmd) {
  try {
    const { execFileSync } = require('node:child_process');
    const probe = process.platform === 'win32' ? 'where' : 'which';
    execFileSync(probe, [cmd], { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch (e) { return false; }
}

/**
 * 显示宽度：中文/日文/韩文是全角（占 2 列），ASCII 占 1 列。
 * 画方框时必须按显示宽度补齐，不能按字符数 —— String.padEnd 会把中文框算歪。
 */
function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||   // 韩文字母
      (c >= 0x2e80 && c <= 0xa4cf) ||   // 中日韩部首、假名、汉字
      (c >= 0xac00 && c <= 0xd7a3) ||   // 韩文音节
      (c >= 0xf900 && c <= 0xfaff) ||   // 兼容汉字
      (c >= 0xfe30 && c <= 0xfe4f) ||   // 中日韩兼容形式
      (c >= 0xff00 && c <= 0xff60) ||   // 全角形式
      (c >= 0xffe0 && c <= 0xffe6) ||
      (c >= 0x1f300 && c <= 0x1f9ff);   // 表情符号
    w += wide ? 2 : 1;
  }
  return w;
}

/** 按显示宽度补空格到指定列数 */
function padDisplay(s, width) {
  const pad = width - displayWidth(s);
  return s + (pad > 0 ? ' '.repeat(pad) : '');
}

/**
 * 打印环境检查结果并给出可照抄的命令。
 *
 * 设计要点（踩过坑）：
 *  - 走 **stdout**：cmd/PowerShell 里用户常常只看到 stdout，stderr 容易被忽略，
 *    早期版本全用 console.error 导致"运行完什么都没有"。
 *  - 开头画框：确保第一眼就能看到失败，而不是被 npm 的 `> script` 标题盖过去。
 *  - 答案先于原因：先给能直接照抄的命令，再列缺什么。
 */
export function reportProblems(problems) {
  if (!problems.length) return false;

  const W = 62;
  const msg = '❌ 运行失败：运行环境不完整';
  const pad = Math.max(0, W - displayWidth(msg) - 2);
  console.log('');
  console.log('┌' + '─'.repeat(W) + '┐');
  console.log('│ ' + msg + ' '.repeat(pad) + ' │');
  console.log('└' + '─'.repeat(W) + '┘');
  console.log('');

  console.log('【照这几步做】');
  const needInstall = problems.some((p) => /npm install/.test(p.fix));
  const needModel = problems.some((p) => /download-model/.test(p.fix));
  let step = 1;

  if (needInstall) {
    if (hasCommand(process.platform === 'win32' ? 'npm.cmd' : 'npm')) {
      console.log('  ' + (step++) + '. 安装依赖（约 100 MB，需要几分钟）');
      console.log('       npm install');
    } else {
      console.log('  ' + (step++) + '. ⚠ 本机找不到 npm —— 需要先安装 Node.js');
      console.log('       https://nodejs.org/  下载 LTS 版本，装完重开命令行窗口');
    }
  }
  if (needModel) {
    console.log('  ' + (step++) + '. 下载识别模型（约 155 MB，自动校验）');
    console.log('       npm run setup');
  }
  console.log('  ' + (step++) + '. 验证是否装好');
  console.log('       npm run check');
  console.log('       （看到 "5 种语言 ... 0.00% 错误" 就是成功了）\n');

  console.log('【缺少的东西】');
  for (const p of problems) {
    console.log('  • ' + p.what);
    console.log('      应为: ' + p.path);
  }
  console.log('');

  console.log('【关于这个文件夹】');
  console.log('  如果这是从 GitHub 下载的源码包，它**不含**模型和依赖（太大，不放进仓库），');
  console.log('  必须先在**本目录**执行上面的 npm install 和 npm run setup。');
  console.log('  若你已在另一个目录（如 asr-local）装好，请到那个目录运行命令。\n');

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

export { require };
