/* ============================================================
 * ITN（数字规范化）行为测试
 *
 *   node tests/itn.test.js
 *
 * 背景：同一次识别，ITN 开关会改变**数字的书写形式**：
 *   ITN=1（默认）  开饭时间早上9点至下午5点。
 *   ITN=0          开饭时间早上九点至下午五点
 *
 * 这不是识别错误，而是输出风格差异。但官方参考文本用的是阿拉伯数字，
 * 所以拿 --no-itn 的输出直接和参考文本比会得到虚高的错误率
 * （实测中文 15.4% vs 真实 0%）。这个测试把这个陷阱固化下来，
 * 避免以后再把"格式差异"误判成"识别退化"。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { MODEL, TOKENS, TEST_WAVS, TMP_DIR, loadReference, REF_LANGS } from '../lib/paths.js';
import { wer } from '../lib/wer.js';

let pass = 0, fail = 0;
const check = (label, cond, detail) => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (detail ? '\n      ' + detail : '')); }
};

/** 测试产物统一写到临时目录，绝不落进仓库 */
const RESULTS_DIR = path.join(TMP_DIR, 'results');

const ref = loadReference();
const sherpa = await import('sherpa-onnx-node');
const { OfflineRecognizer, readWave } = sherpa.default || sherpa;

const rec = (itn) => new OfflineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    senseVoice: { model: MODEL, useInverseTextNormalization: itn, language: 'auto' },
    tokens: TOKENS, numThreads: 4, provider: 'cpu', debug: 0,
  },
  decodingMethod: 'greedy_search',
});
const run = (r, wav) => {
  const w = readWave(wav);
  const st = r.createStream();
  st.acceptWaveform({ samples: w.samples, sampleRate: w.sampleRate });
  r.decode(st);
  return r.getResult(st).text.trim();
};

const R1 = rec(1), R0 = rec(0);
const out = {};

console.log('=== ITN 开关对输出的影响 ===\n');
for (const lg of REF_LANGS) {
  const wav = path.join(TEST_WAVS, lg + '.wav');
  if (!fs.existsSync(wav) || !ref[lg]) continue;
  const t1 = run(R1, wav);
  const t0 = run(R0, wav);
  const byWord = lg === 'en';
  out[lg] = { itn1: t1, itn0: t0, wer1: wer(ref[lg], t1, byWord).rate, wer0: wer(ref[lg], t0, byWord).rate };

  const same = t1 === t0;
  console.log(lg.toUpperCase() + (same ? '  （ITN 开关无差异）' : '  （ITN 开关有差异）'));
  if (!same) {
    console.log('    ITN=1: ' + JSON.stringify(t1));
    console.log('    ITN=0: ' + JSON.stringify(t0));
    console.log('    对参考文本的错误率: ITN=1 → ' + (out[lg].wer1 * 100).toFixed(1) +
      '%   ITN=0 → ' + (out[lg].wer0 * 100).toFixed(1) + '%');
  }
  console.log('');
}

/* ---------------- 断言 ---------------- */

console.log('--- 断言 ---');

/* 1. ITN=1 应当与官方参考文本完全一致（这是 benchmark 声称 0% 的前提） */
for (const lg of REF_LANGS) {
  if (!out[lg]) continue;
  check('ITN=1 与参考文本一致: ' + lg.toUpperCase(),
    ref[lg].replace(/\s/g, '') === out[lg].itn1.replace(/\s/g, ''),
    '真值 ' + JSON.stringify(ref[lg]) + '\n      识别 ' + JSON.stringify(out[lg].itn1));
}

/* 2. 含数字的样本，ITN=0 应当把数字写成汉字/单词，且因此与参考文本不一致（预期行为） */
if (out.zh) {
  const hasArabic = /[0-9]/.test(out.zh.itn1);
  const hasChineseNum = /[一二三四五六七八九十百千零]/.test(out.zh.itn0);
  check('中文 ITN=1 输出阿拉伯数字', hasArabic, '实际: ' + JSON.stringify(out.zh.itn1));
  check('中文 ITN=0 输出汉字数字', hasChineseNum, '实际: ' + JSON.stringify(out.zh.itn0));
  check('中文 ITN=0 与参考文本不符（预期，因数字写法不同）', out.zh.wer0 > 0,
    'ITN=0 WER=' + (out.zh.wer0 * 100).toFixed(1) + '%（若为 0 说明该样本不含数字）');
}

/* 3. ITN 开关不应导致**内容**丢失（差异应集中在数字写法与标点）
      注意：数字改写成词会显著变长（"50" → "fifty" 是 3 字符差），
      所以容差按英文最长数字词估算，而不是拍脑袋定 2。 */
for (const lg of REF_LANGS) {
  if (!out[lg]) continue;
  const a = [...out[lg].itn1.replace(/[\s。．.，,、]/g, '')];
  const b = [...out[lg].itn0.replace(/[\s。．.，,、]/g, '')];
  const lenDiff = Math.abs(a.length - b.length);
  check('ITN 开关不显著改变长度: ' + lg.toUpperCase(), lenDiff <= 5,
    'ITN=1 ' + a.length + ' 字符, ITN=0 ' + b.length + ' 字符 (差 ' + lenDiff + ')');
}

console.log('\n--- 结论 ---');
console.log('  · 对外宣称准确度请用 **ITN=1（默认）** 的结果，因为官方参考文本用阿拉伯数字。');
console.log('  · 用 --no-itn 时与参考文本比对会虚高错误率，属格式差异而非识别退化。');
console.log('  · 需要保留口语数字写法（如字幕、逐字稿）时才用 --no-itn。');

/* 结果写到临时目录，**不要写进仓库** —— 否则跑完测试再提交会把产物带进去 */
fs.mkdirSync(RESULTS_DIR, { recursive: true });
fs.writeFileSync(path.join(RESULTS_DIR, 'itn-result.json'), JSON.stringify(out, null, 2), 'utf8');

console.log('\n' + '='.repeat(44));
console.log('通过 ' + pass + ' / ' + (pass + fail) + (fail ? '，失败 ' + fail + ' ❌' : '，全部通过 ✅'));
process.exitCode = fail ? 1 : 0;
