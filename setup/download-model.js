/* ============================================================
 * 下载 SenseVoice int8 模型包（安装脚本）
 *
 *   node setup/download-model.js
 *
 * 约 155 MB 压缩包，解出 228 MB 的 onnx 模型 + tokens.txt + 测试音频。
 * 下载后自动用官方 SHA256 校验（值与 DSH 官方语音插件一致）。
 *
 * 官方源在 HuggingFace：
 *   https://huggingface.co/csukuangfj/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17
 * 若你的网络可以直连 HuggingFace，设置 HF_ENDPOINT 或直接改 ASSET 用官方源即可。
 * 默认走 GitHub 代理（国内网络环境更稳），多个代理自动轮换。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  ROOT, CACHE_DIR, MODELS_DIR, MODEL, TOKENS, TEST_WAVS, VAD_MODEL,
  MODEL_SHA256, TOKENS_SHA256, loadReference,
} from '../lib/paths.js';

/* 模型包的官方地址（k2-fsa release 资产） */
const ASSET = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/' +
  'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2';

/* silero VAD：长音频分块时用来找自然停顿。
   注意这个文件**没有稳定的 SHA256** —— 官方 assets.json 记的是 1807522 字节那一版，
   而 release 上现在能拿到的是 643854 字节那一版。所以只校验大小与可加载性。 */
const VAD_ASSET = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/silero_vad.onnx';

/* GitHub 代理，按顺序尝试；直连可用的话把 '' 放最前面 */
const PROXIES = ['', 'https://gh-proxy.com/', 'https://ghfast.top/', 'https://ghproxy.net/'];

const TARBALL = path.join(CACHE_DIR, 'sensevoice-int8.tar.bz2');

const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/** 下载单个文件（多代理轮换） */
async function downloadFile(url, dest, label) {
  for (const px of PROXIES) {
    const full = px + url;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10 * 60 * 1000);
    try {
      const r = await fetch(full, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctl.signal, redirect: 'follow' });
      if (r.status !== 200) continue;
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 1000) continue;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, buf);
      console.log('  ✅ ' + label + '  ' + (buf.length / 1024).toFixed(0) + ' KB');
      return true;
    } catch (e) { /* 试下一个 */ } finally { clearTimeout(timer); }
  }
  console.log('  ⚠ ' + label + ' 下载失败（不影响基本使用，只是长音频不分块）');
  return false;
}

/**
 * 把 test_wavs/*.txt 同步成仓库内 lib/sensevoice-reference.json 的内容。
 *
 * k2-fsa 的 tar 包只含 .wav，不含 .txt，所以这些文件要靠我们自己写。
 * 必须**无条件覆盖**：模型目录里可能残留旧版本（实测 ja.txt 里 "持ってき"
 * 是错的，模型实际输出是 "持っていき"），只在文件缺失时补写的话，
 * 过期数据永远不会被纠正。
 */
function syncReferenceTxt() {
  if (!fs.existsSync(TEST_WAVS)) return;
  const ref = loadReference();
  if (ref.error) { console.log('  ⚠ 无法读取参考文本，跳过同步: ' + ref.error); return; }
  let synced = 0, fixed = 0;
  for (const [lg, text] of Object.entries(ref)) {
    const p = path.join(TEST_WAVS, lg + '.txt');
    const want = text + '\n';
    const has = fs.existsSync(p);
    if (!has || fs.readFileSync(p, 'utf8') !== want) {
      if (has) fixed++;
      fs.writeFileSync(p, want, 'utf8');
    }
    synced++;
  }
  console.log('  ✅ 参考答案（同步 ' + synced + ' 个 .txt' +
    (fixed ? '，纠正 ' + fixed + ' 个过期文件' : '') + '）');
}

/* ---------- 已装好则直接校验并退出 ---------- */
if (fs.existsSync(MODEL) && fs.existsSync(TOKENS)) {
  const a = sha256File(MODEL);
  const ok = a === MODEL_SHA256;
  console.log('模型已存在 (' + (fs.statSync(MODEL).size / 1048576).toFixed(1) + ' MB)');
  console.log('SHA256 ' + (ok ? '✅ 校验通过' : '⚠ 不匹配\n  实际 ' + a + '\n  期望 ' + MODEL_SHA256));
  /* VAD 可能上次没装上，补装 */
  if (!fs.existsSync(VAD_MODEL)) {
    console.log('\n补装 VAD 模型（长音频分块用）...');
    await downloadFile(VAD_ASSET, VAD_MODEL, 'silero_vad.onnx');
  }
  /* 提前退出前也要同步参考文本 —— 否则旧版本残留永远修不掉 */
  console.log('');
  syncReferenceTxt();
  process.exit(ok ? 0 : 1);
}

console.log('准备安装 SenseVoice int8 模型');
console.log('  模型目录: ' + MODELS_DIR);
console.log('  下载地址: ' + ASSET.split('/').pop() + '  (约 155 MB)\n');

fs.mkdirSync(CACHE_DIR, { recursive: true });
fs.mkdirSync(MODELS_DIR, { recursive: true });

/* ---------- 下载 ---------- */
if (!fs.existsSync(TARBALL) || fs.statSync(TARBALL).size < 1000) {
  let done = false;
  for (const px of PROXIES) {
    if (done) break;
    const url = px + ASSET;
    const label = px || '直连 GitHub';
    console.log('尝试 ' + label);
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 30 * 60 * 1000);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctl.signal, redirect: 'follow' });
      if (r.status !== 200) { console.log('  HTTP ' + r.status + '，换下一个源\n'); continue; }

      const total = Number(r.headers.get('content-length') || 0);
      const out = fs.createWriteStream(TARBALL);
      const hash = crypto.createHash('sha256');
      let got = 0, lastPct = -1;
      const t0 = Date.now();
      const reader = r.body.getReader();
      while (true) {
        const { done: d, value } = await reader.read();
        if (d) break;
        out.write(Buffer.from(value));
        hash.update(value);
        got += value.length;
        const pct = total ? Math.floor((got / total) * 100) : 0;
        if (pct >= lastPct + 10) {
          lastPct = pct;
          console.log('  ' + String(pct).padStart(3) + '%  ' + (got / 1048576).toFixed(1) + 'MB  ' +
            (got / 1048576 / ((Date.now() - t0) / 1000)).toFixed(2) + 'MB/s');
        }
      }
      await new Promise((res) => out.end(res));
      console.log('  完成 ' + (got / 1048576).toFixed(1) + 'MB，用时 ' + ((Date.now() - t0) / 1000).toFixed(0) + 's\n');
      done = true;
    } catch (e) {
      console.log('  失败: ' + e.message + '，换下一个源\n');
      try { fs.rmSync(TARBALL, { force: true }); } catch (e2) {}
    } finally { clearTimeout(timer); }
  }
  if (!done) {
    console.error('❌ 所有下载源均失败。\n');
    console.error('请手动下载下面的文件，放到 ' + CACHE_DIR + ' 后重跑本脚本：');
    console.error('  ' + ASSET);
    console.error('\n或设置代理后重试，例如：');
    console.error('  $env:HTTPS_PROXY="http://127.0.0.1:7890"');
    process.exit(1);
  }
} else {
  console.log('使用已缓存的压缩包: ' + TARBALL + '\n');
}

/* ---------- 解包 ---------- */
console.log('解包到 ' + MODELS_DIR);
try {
  execFileSync('tar', ['-xjf', TARBALL, '-C', MODELS_DIR], { stdio: 'pipe', timeout: 600000 });
} catch (e) {
  console.error('❌ 解包失败: ' + (e.stderr || e.message).toString().slice(0, 300));
  console.error('   请确认系统有 tar 命令，或手动解包到 ' + MODELS_DIR);
  process.exit(1);
}

/* ---------- 校验 ---------- */
console.log('\n完整性校验');
const verify = (file, expect, label) => {
  if (!fs.existsSync(file)) { console.log('  ❌ 缺少 ' + label); return false; }
  const a = sha256File(file);
  const ok = a === expect;
  console.log('  ' + (ok ? '✅' : '❌') + ' ' + label + '  ' + (fs.statSync(file).size / 1048576).toFixed(1) + ' MB');
  if (!ok) console.log('      实际 ' + a + '\n      期望 ' + expect);
  return ok;
};

const okModel = verify(MODEL, MODEL_SHA256, 'model.int8.onnx');
const okTokens = verify(TOKENS, TOKENS_SHA256, 'tokens.txt');
const hasTests = fs.existsSync(TEST_WAVS);
console.log('  ' + (hasTests ? '✅' : '⚠ ') + ' test_wavs（样例音频）');

/* ---------- VAD 模型（长音频分块用） ---------- */
console.log('\nVAD 模型（长音频找自然停顿用）');
if (fs.existsSync(VAD_MODEL) && fs.statSync(VAD_MODEL).size > 100000) {
  console.log('  ✅ silero_vad.onnx  ' + (fs.statSync(VAD_MODEL).size / 1024).toFixed(0) + ' KB');
} else {
  await downloadFile(VAD_ASSET, VAD_MODEL, 'silero_vad.onnx');
  if (fs.existsSync(VAD_MODEL)) {
    /* 验证能被 sherpa-onnx 加载（这个文件没有稳定 SHA256，改成加载性验证） */
    try {
      const sherpa = await import('sherpa-onnx-node');
      const { Vad } = sherpa.default || sherpa;
      new Vad({
        sileroVad: { model: VAD_MODEL, threshold: 0.5, minSilenceDuration: 0.35, minSpeechDuration: 0.25, windowSize: 512 },
        sampleRate: 16000, numThreads: 1, provider: 'cpu', debug: 0,
      });
      console.log('  ✅ 加载性验证通过（该文件无稳定 SHA256，改为验证可加载）');
    } catch (e) {
      console.log('  ⚠ 加载失败，长音频将退回整段识别: ' + e.message.slice(0, 100));
      try { fs.unlinkSync(VAD_MODEL); } catch (e2) { }
    }
  }
}

/* ---------- 同步参考答案 ---------- */
syncReferenceTxt();

if (okModel && okTokens) {
  try { fs.rmSync(CACHE_DIR, { recursive: true, force: true }); console.log('\n已清理缓存 .cache'); } catch (e) {}
  console.log('\n✅ 安装完成。运行以下命令验证：\n   node transcribe.js --check\n');
  process.exit(0);
} else {
  console.error('\n❌ 校验未通过，文件可能损坏。请删除 models/ 后重试。');
  process.exit(1);
}
