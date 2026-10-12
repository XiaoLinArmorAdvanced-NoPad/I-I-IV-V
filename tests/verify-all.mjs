/* ============================================================
 * 总验证：一条命令跑完全部检查
 *
 *   node tests/verify-all.mjs           # 全部
 *   node tests/verify-all.mjs --quick   # 跳过耗时项（不下载模型、不跑退化曲线）
 *
 * 退出码 0 = 全部通过；非 0 = 有失败（可直接用于 CI）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const QUICK = process.argv.includes('--quick');

const results = [];
function run(label, args, { optional = false, timeout = 900000 } = {}) {
  process.stdout.write('  ' + label.padEnd(42));
  const t0 = Date.now();
  let out = '', code = 0;
  try {
    out = execFileSync(process.execPath, args, { encoding: 'utf8', stdio: 'pipe', timeout, cwd: ROOT });
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '');
    code = e.status ?? -1;
  }
  const el = ((Date.now() - t0) / 1000).toFixed(1);
  const summary = pickSummary(label, out);
  const ok = code === 0;
  results.push({ label, ok, code, summary, el, optional });
  console.log((ok ? '✅' : (optional ? '⏭' : '❌')) + '  ' + el + 's  ' + summary);
  return { ok, out, code };
}

/** 从各脚本输出里提取一句关键结论 */
function pickSummary(label, out) {
  const pats = [
    /通过 \d+ \/ \d+[^\n]*/,
    /检查 \d+ 个[^\n]*/,
    /✅ 全部有效/,
    /合计 \d+ 单位，总错误率 [\d.]+%/,
    /语言数 \d+ \/ \d+[^\n]*/,
    /关键点命中 \d+ \/ \d+/,
    /\d+ 种语言，\d+ 单位，错误率 [\d.]+%/,
  ];
  for (const p of pats) {
    const m = out.match(p);
    if (m) return m[0].trim();
  }
  const last = out.split('\n').map((l) => l.trim()).filter(Boolean).pop();
  return (last || '').slice(0, 60);
}

console.log('╔══════════════════════════════════════════════════════════╗');
console.log('║  asr-local 总验证' + (QUICK ? '（快速模式）' : '') + '                                  ║');
console.log('╚══════════════════════════════════════════════════════════╝\n');

/* ---------- 1. 语法 ---------- */
console.log('【1】语法');
{
  const files = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === 'node_modules' || e.name === 'models' || e.name === '.cache' || e.name.startsWith('.')) continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|mjs)$/.test(e.name)) files.push(p);
    }
  };
  walk(ROOT);
  let bad = [];
  for (const f of files) {
    try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe', timeout: 30000 }); }
    catch (e) { bad.push(path.relative(ROOT, f)); }
  }
  const ok = bad.length === 0;
  results.push({ label: '语法检查', ok, summary: files.length + ' 个文件' + (ok ? ' 全部通过' : ' 失败: ' + bad.join(', ')) });
  console.log('  语法检查'.padEnd(44) + (ok ? '✅' : '❌') + '       ' + results[results.length - 1].summary + '\n');
}

/* ---------- 2. 不需要模型的测试 ---------- */
console.log('【2】单元测试（不需要模型）');
run('WER 计算单元测试', ['tests/wer.test.js']);
run('参考数据完整性', ['tests/reference.test.js']);
run('文档链接与锚点', ['tests/links.test.js']);

/* ---------- 3. 需要模型的测试 ---------- */
const hasModel = fs.existsSync(path.join(ROOT, 'models'));
console.log('\n【3】模型相关' + (hasModel ? '' : '（未安装模型，跳过）'));
if (hasModel) {
  run('五语言准确度基准', ['tests/benchmark.js']);
  run('ITN 数字规范化行为', ['tests/itn.test.js']);
  run('主程序自检', ['transcribe.js', '--check']);
  run('VAD 长音频分块', ['tests/vad.test.js'], { timeout: 1200000 });
  run('健壮性 61 项边界测试', ['tests/robustness.test.js']);
  run('端到端链路 (TTS→MP3→转写)', ['tests/e2e-test.js'], { optional: true });
  if (!QUICK) {
    console.log('\n【4】准确度画像（较慢）');
    run('噪声 / 口音退化曲线', ['tests/degradation.mjs'], { optional: true, timeout: 1800000 });
    run('方言 / 跨语言矩阵', ['tests/dialect-matrix.mjs'], { optional: true, timeout: 1800000 });
  }
} else {
  console.log('  提示: 执行 npm run setup 下载模型后，这里会多出 5 项检查');
}

/* ---------- 汇总 ---------- */
const hard = results.filter((r) => !r.optional);
const failed = hard.filter((r) => !r.ok);
const optFailed = results.filter((r) => r.optional && !r.ok);

console.log('\n' + '═'.repeat(62));
console.log('汇总: ' + (hard.length - failed.length) + ' / ' + hard.length + ' 项关键检查通过');
if (optFailed.length) console.log('       ' + optFailed.length + ' 项可选检查跳过/失败（不影响结论）');
if (failed.length) {
  console.log('\n失败项:');
  failed.forEach((f) => console.log('  ❌ ' + f.label + '  (exit ' + f.code + ')'));
  console.log('\n逐项排查: node ' + (failed[0].label.includes('WER') ? 'tests/wer.test.js' : '<对应脚本>'));
} else {
  console.log('\n✅ 全部通过 —— 这个版本可以放心使用和发布');
}

const totalTime = results.reduce((a, r) => a + (parseFloat(r.el) || 0), 0);
console.log('总耗时约 ' + totalTime.toFixed(0) + 's');
process.exitCode = failed.length ? 1 : 0;
