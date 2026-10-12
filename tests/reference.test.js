/* ============================================================
 * 参考文本数据文件的完整性测试
 *
 *   node tests/reference.test.js
 *
 * 为什么需要这个测试：
 * k2-fsa 的模型 release tar 包**只含 test_wavs/*.wav，不含 *.txt**。
 * 早期版本从 test_wavs/<lang>.txt 读真值，在全新环境（CI、别人的电脑）里
 * 找不到文件 → 准确度测试静默跳过 → 却报"✅ 全部通过"。
 * CI 因此长期假绿，声称的 0.00% 错误**根本没被验证过**。
 *
 * 这个测试保证：参考文本始终随仓库存在、格式正确、且与样例音频一一对应。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { REFERENCE_FILE, TEST_WAVS, loadReference, REF_LANGS } from '../lib/paths.js';

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

console.log('=== 参考文本数据文件 ===\n');

check('文件存在', fs.existsSync(REFERENCE_FILE), REFERENCE_FILE);

const ref = loadReference();
check('可解析为 JSON', !ref.error, ref.error || '');
check('不是空对象', Object.keys(ref).length > 0);

console.log('\n--- 语种覆盖 ---');
for (const lg of REF_LANGS) {
  const v = ref[lg];
  check(lg + ' 有参考文本', typeof v === 'string' && v.trim().length > 0,
    '缺少 ' + lg);
}
const extra = Object.keys(ref).filter((k) => !REF_LANGS.includes(k));
check('没有多余的语种键', extra.length === 0, extra.length ? '多余: ' + extra.join(', ') : '');

console.log('\n--- 内容合理性 ---');
for (const lg of REF_LANGS) {
  if (!ref[lg]) continue;
  const t = ref[lg];
  check(lg + ' 长度合理 (3–200 字符)', t.length >= 3 && t.length <= 200, '实际 ' + t.length);
  check(lg + ' 无多余空白/换行', t === t.trim() && !/[\r\n]/.test(t));
}

console.log('\n--- 与样例音频的对应关系 ---');
if (!fs.existsSync(TEST_WAVS)) {
  console.log('  ⚠ 模型未安装，跳过音频对应检查（CI 会在装完模型后跑到这里）');
} else {
  for (const lg of REF_LANGS) {
    const wav = path.join(TEST_WAVS, lg + '.wav');
    check(lg + '.wav 存在', fs.existsSync(wav), wav);
  }
  /* 反向：模型目录里若有参考文本，必须与仓库内一致 */
  for (const lg of REF_LANGS) {
    const p = path.join(TEST_WAVS, lg + '.txt');
    if (!fs.existsSync(p)) { console.log('  · ' + lg + '.txt 不存在（正常，setup 才会补写）'); continue; }
    const disk = fs.readFileSync(p, 'utf8').trim();
    check(lg + '.txt 与仓库内一致', disk === ref[lg],
      '模型目录: ' + JSON.stringify(disk) + '\n      仓库内  : ' + JSON.stringify(ref[lg]));
  }
}

console.log('\n--- 关键回归：英文参考文本 ---');
/* 这条是当年实测 0% 错误的那句话，锁死它避免被误改 */
check('英文真值与实测一致',
  ref.en === 'The tribal chieftain called for the boy and presented him with 50 pieces of code.',
  '实际: ' + JSON.stringify(ref.en));

console.log('\n========================================');
console.log('通过 ' + pass + ' / ' + (pass + fail) + (fail ? '，失败 ' + fail : '，全部通过 ✅'));
process.exitCode = fail ? 1 : 0;
