/* 文本比对工具：词/字错误率（WER/CER）与差异明细
 *
 * 注意：DP 表必须逐行新建数组。写成
 *   Array.from({length:m+1}, (_, i) => Array.from({length:n+1}, (_, j) => ...))
 * 会因箭头函数只看第二个参数而得到全零行，导致距离计算出荒谬的值。
 * 这个 bug 在本项目里真实发生过一次，害我把 21% 的 WER 读成 94%。
 */

/** 英文按词切分，中日韩粤按字切分 */
export function tokenize(text, byWord = true) {
  if (byWord) {
    return text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  }
  return text.replace(/[\s，。、！？；：""''（）,.!?;:()\-—…]/g, '').split('').filter(Boolean);
}

/** 编辑距离 + 回溯差异 */
export function align(refTokens, hypTokens) {
  const m = refTokens.length;
  const n = hypTokens.length;

  const dp = [];
  for (let i = 0; i <= m; i++) {
    dp.push(new Array(n + 1).fill(0));
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = refTokens[i - 1] === hypTokens[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }

  /* 回溯：~ 替换 / - 漏识 / + 多识 */
  let i = m, j = n;
  const ops = [];
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && refTokens[i - 1] === hypTokens[j - 1]) { i--; j--; }
    else if (i > 0 && j > 0 && dp[i][j] === dp[i - 1][j - 1] + 1) {
      ops.push({ op: 'sub', ref: refTokens[i - 1], hyp: hypTokens[j - 1] }); i--; j--;
    } else if (i > 0 && dp[i][j] === dp[i - 1][j] + 1) {
      ops.push({ op: 'del', ref: refTokens[i - 1] }); i--;
    } else {
      ops.push({ op: 'ins', hyp: hypTokens[j - 1] }); j--;
    }
  }
  ops.reverse();

  return {
    distance: dp[m][n],
    refLen: m,
    hypLen: n,
    rate: m ? dp[m][n] / m : 0,
    correct: m - ops.filter((o) => o.op !== 'ins').length,
    ops: ops.filter((o) => o.op !== 'equal'),
    exact: refTokens.join(' ') === hypTokens.join(' '),
  };
}

/** 便捷入口：直接比字符串 */
export function wer(ref, hyp, byWord = true) {
  return align(tokenize(ref, byWord), tokenize(hyp, byWord));
}

/** 人类可读的差异串 */
export function describeOps(ops) {
  return ops.map((o) => {
    if (o.op === 'sub') return `改[${o.ref}→${o.hyp}]`;
    if (o.op === 'del') return `漏[${o.ref}]`;
    return `多[${o.hyp}]`;
  }).join(' ');
}
