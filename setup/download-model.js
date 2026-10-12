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
  ROOT, CACHE_DIR, MODELS_DIR, MODEL, TOKENS, TEST_WAVS,
  MODEL_SHA256, TOKENS_SHA256, loadReference,
} from '../lib/paths.js';

/* 模型包的官方地址（k2-fsa release 资产） */
const ASSET = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/' +
  'sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2';

/* GitHub 代理，按顺序尝试；直连可用的话把 '' 放最前面 */
const PROXIES = ['', 'https://gh-proxy.com/', 'https://ghfast.top/', 'https://ghproxy.net/'];

const TARBALL = path.join(CACHE_DIR, 'sensevoice-int8.tar.bz2');

const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/* ---------- 已装好则直接校验并退出 ---------- */
if (fs.existsSync(MODEL) && fs.existsSync(TOKENS)) {
  const a = sha256File(MODEL);
  const ok = a === MODEL_SHA256;
  console.log('模型已存在 (' + (fs.statSync(MODEL).size / 1048576).toFixed(1) + ' MB)');
  console.log('SHA256 ' + (ok ? '✅ 校验通过' : '⚠ 不匹配\n  实际 ' + a + '\n  期望 ' + MODEL_SHA256));
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

/* ---------- 补写参考答案 ----------
 * k2-fsa 的 tar 包只含 test_wavs/*.wav，不含 *.txt。
 * 这里用仓库内的 lib/sensevoice-reference.json 把 .txt 补上，
 * 让模型目录自洽（benchmark 已改为直接读 json，这里只是保持目录完整）。 */
if (hasTests) {
  const ref = loadReference();
  if (ref.error) {
    console.log('  ⚠ 无法读取参考文本，跳过补写: ' + ref.error);
  } else {
    let wrote = 0;
    for (const [lg, text] of Object.entries(ref)) {
      const p = path.join(TEST_WAVS, lg + '.txt');
      if (!fs.existsSync(p)) { fs.writeFileSync(p, text + '\n', 'utf8'); wrote++; }
    }
    console.log('  ✅ 参考答案（补写 ' + wrote + ' 个 .txt，共 ' + Object.keys(ref).length + ' 种语言）');
  }
}

if (okModel && okTokens) {
  try { fs.rmSync(CACHE_DIR, { recursive: true, force: true }); console.log('\n已清理缓存 .cache'); } catch (e) {}
  console.log('\n✅ 安装完成。运行以下命令验证：\n   node transcribe.js --check\n');
  process.exit(0);
} else {
  console.error('\n❌ 校验未通过，文件可能损坏。请删除 models/ 后重试。');
  process.exit(1);
}
