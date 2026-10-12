/* ============================================================
 * 兜底方案（仅在上面的下载失败时才需要）
 *
 * 从 ModelScope 的 iic/SenseVoiceSmall 仓库拉 PyTorch 权重。
 * 注意：这是 .pt 格式，sherpa-onnx 需要 .onnx，**不能直接使用**。
 * 只在确实找不到 onnx 时才考虑，需要自行转换（export-onnx.py）。
 *
 * 正常情况请用：
 *   node setup/download-model.js
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, CACHE_DIR, MODEL_DIR } from '../lib/paths.js';

const API = 'https://www.modelscope.cn/api/v1/models/iic/SenseVoiceSmall/repo';
const REVISION = 'master';

console.log('=== 列出 ModelScope 仓库文件 ===');
const listUrl = API + '/files?Revision=' + REVISION + '&Recursive=true';
let files = [];
try {
  const r = await fetch(listUrl, { headers: { 'User-Agent': 'Mozilla/5.0' } });
  if (r.status !== 200) throw new Error('HTTP ' + r.status);
  const j = await r.json();
  files = (j.Data && j.Data.Files) || [];
} catch (e) {
  console.error('查询失败: ' + e.message);
  process.exit(1);
}

if (!files.length) { console.error('仓库为空或接口变更'); process.exit(1); }

console.log('共 ' + files.length + ' 个文件:');
for (const f of files) {
  const mb = f.Size ? (f.Size / 1048576).toFixed(2) + 'MB' : '-';
  console.log('  ' + String(f.Path).padEnd(46) + mb.padStart(10));
}

const onnx = files.filter((f) => /\.onnx$/i.test(f.Path));
console.log('');
if (!onnx.length) {
  console.log('⚠ 该仓库没有 .onnx 文件。');
  console.log('  sherpa-onnx 无法直接使用 .pt 权重，需要先转换。');
  console.log('  请优先使用主下载脚本：node setup/download-model.js');
  process.exit(2);
}

console.log('发现 ' + onnx.length + ' 个 onnx 文件，开始下载到 ' + MODEL_DIR);
fs.mkdirSync(MODEL_DIR, { recursive: true });
fs.mkdirSync(CACHE_DIR, { recursive: true });

for (const f of onnx) {
  const dest = path.join(MODEL_DIR, path.basename(f.Path));
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) { console.log('  [已有] ' + path.basename(dest)); continue; }
  const url = API + '?Revision=' + REVISION + '&FilePath=' + encodeURIComponent(f.Path);
  console.log('  下载 ' + f.Path + ' ...');
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' });
    if (r.status !== 200) { console.log('    HTTP ' + r.status); continue; }
    const buf = Buffer.from(await r.arrayBuffer());
    fs.writeFileSync(dest, buf);
    console.log('    OK ' + (buf.length / 1048576).toFixed(1) + 'MB');
  } catch (e) { console.log('    失败: ' + e.message); }
}

console.log('\n完成。注意：从本仓库拿到的模型可能缺少 tokens.txt，');
console.log('需要配合主下载脚本获取完整模型包。');
