/* ============================================================
 * lib/wer.js 单元测试
 *
 *   node tests/wer.test.js
 *
 * 其中"回归测试"一节固化了一个真实发生过的 bug：
 * DP 表用 Array.from({length:m+1}, (_, i) => Array.from({length:n+1}, (_, j) => ...))
 * 写法时，箭头函数只接到第二个参数，导致每行都是全零、距离算出荒谬的值。
 * 当时把 21% 的 WER 读成了 94%，据此差点推翻正确的答案。
 * ============================================================ */
import { tokenize, align, wer, describeOps } from '../lib/wer.js';

let pass = 0, fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (ok) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + '\n      得到 ' + JSON.stringify(got) + '\n      期望 ' + JSON.stringify(want)); }
};

console.log('=== tokenize ===');
eq('英文按词切分', tokenize('Hello, world!', true), ['hello', 'world']);
eq('英文去标点', tokenize("It's a test.", true), ['it', 's', 'a', 'test']);
eq('中文按字切分', tokenize('开饭时间早上9点。', false), ['开', '饭', '时', '间', '早', '上', '9', '点']);
eq('中文去标点', tokenize('你好，世界！', false), ['你', '好', '世', '界']);
eq('空串', tokenize('', true), []);

console.log('\n=== align ===');
eq('完全相同', align(['a', 'b', 'c'], ['a', 'b', 'c']).distance, 0);
eq('完全相同 rate', align(['a', 'b', 'c'], ['a', 'b', 'c']).rate, 0);
eq('全替换', align(['a', 'b', 'c'], ['x', 'y', 'z']).distance, 3);
eq('一个漏词', align(['a', 'b', 'c'], ['a', 'c']).distance, 1);
eq('一个多词', align(['a', 'c'], ['a', 'b', 'c']).distance, 1);
eq('一替换一漏', align(['a', 'b', 'c'], ['a', 'x']).distance, 2);
eq('空参考不除零', align([], ['a']).rate, 0);
eq('差异明细-替换', align(['a', 'b'], ['a', 'x']).ops, [{ op: 'sub', ref: 'b', hyp: 'x' }]);
eq('差异明细-漏', align(['a', 'b'], ['a']).ops, [{ op: 'del', ref: 'b' }]);
eq('差异明细-多', align(['a'], ['a', 'b']).ops, [{ op: 'ins', hyp: 'b' }]);

console.log('\n=== wer（字符串入口）===');
eq('英文相同', wer('the quick brown fox', 'the quick brown fox', true).distance, 0);
eq('英文大小写与标点归一', wer('The Quick, Brown Fox!', 'the quick brown fox', true).distance, 0);
eq('英文一错', wer('the quick brown fox', 'the quick brown box', true).distance, 1);
eq('中文一字错', wer('开饭时间', '开饭时问', false).distance, 1);

console.log('\n=== 回归测试：DP 表必须逐行独立 ===');
/* 这个用例专门锁死上面那个 bug：错写法会让距离变成接近 refLen 的荒谬值 */
{
  const ref = 'the most striking finding was that babies who were exposed to higher levels of light'.split(' ');
  const hyp = 'the most striking finding was that babies who were exposed to higher levels of light'.split(' ');
  const r = align(ref, hyp);
  eq('39 词全同 → 距离 0', r.distance, 0);
  eq('39 词全同 → 正确数 = 参考长度', r.correct, ref.length);
}
{
  /* 干净的单替换：除 pos 2 外全同 → 距离必须恰好 1 */
  const ref = 'a b c d e f g h i j k l m n o p q r s t'.split(' ');
  const hyp = ref.slice();
  hyp[2] = 'X';
  const r = align(ref, hyp);
  eq('20 词错 1 个 → 距离 1', r.distance, 1);
}
{
  /* 10 词错 1 个 → WER 恰好 10% */
  const ref = 'a b c d e f g h i j'.split(' ');
  const hyp = ref.slice();
  hyp[7] = 'X';
  const r = align(ref, hyp);
  eq('10 词错 1 个 → WER 10%', Math.round(r.rate * 100), 10);
}
{
  /* 尾部多出 3 词的插入 */
  const ref = 'a b c d e'.split(' ');
  const hyp = 'a b c d e f g h'.split(' ');
  const r = align(ref, hyp);
  eq('尾部多 3 词 → 距离 3', r.distance, 3);
}
{
  /* 乱序检测：长度不一致时也不能算出超过 max(m,n) 的距离 */
  const ref = 'one two three four five'.split(' ');
  const hyp = 'one two three four five six seven eight'.split(' ');
  const r = align(ref, hyp);
  eq('距离不超过 max(参考,识别)', r.distance <= Math.max(r.refLen, r.hypLen), true);
  eq('多出 3 词 → 距离 3', r.distance, 3);
}

console.log('\n=== describeOps ===');
eq('替换', describeOps([{ op: 'sub', ref: 'a', hyp: 'b' }]), '改[a→b]');
eq('漏词', describeOps([{ op: 'del', ref: 'a' }]), '漏[a]');
eq('多词', describeOps([{ op: 'ins', hyp: 'b' }]), '多[b]');

console.log('\n=== 真实场景（听力作业第 1 题的原文比对）===');
{
  /* 参考 12 词，识别把 relaxed 写成 relax → 1 个错误 → 8.33% */
  const ref = 'They are easy to follow and they keep me relaxed yet engaged.';
  const got = 'They are easy to follow and they keep me relax yet engaged.';
  const r = wer(ref, got, true);
  eq('参考为 12 词', r.refLen, 12);
  eq('relaxed→relax 记 1 个错误', r.distance, 1);
  eq('WER 8.33% → 取整 8', Math.round(r.rate * 100), 8);
}

console.log('\n========================================');
console.log('通过 ' + pass + ' / ' + (pass + fail) + (fail ? '，失败 ' + fail : '，全部通过 ✅'));
process.exitCode = fail ? 1 : 0;
