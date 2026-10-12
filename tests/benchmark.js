/* ============================================================
 * 准确度评测：用官方参考文本作真值，逐字比对
 *
 * 用法：node tests/benchmark.js
 *
 * 真值来源：lib/sensevoice-reference.json（随仓库分发）
 * 音频来源：<model>/test_wavs/*.wav（随模型包分发）
 *
 * 注意：k2-fsa 的 release tar 包只有 .wav，没有 .txt。
 * 早期版本读 test_wavs/<lang>.txt，在全新环境里找不到文件就静默跳过、
 * 还报"全部通过"——CI 上因此长期是假绿。现在真值随仓库走。
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { MODEL, TOKENS, TEST_WAVS, loadReference, REF_LANGS } from '../lib/paths.js';
import { wer, describeOps } from '../lib/wer.js';

const reference = loadReference();
if (reference.error) {
  console.error('❌ ' + reference.error);
  process.exit(1);
}

if (!fs.existsSync(TEST_WAVS)) {
  console.error('❌ 缺少样例音频目录: ' + TEST_WAVS);
  console.error('   执行 npm run setup 重新安装模型。');
  process.exit(1);
}

const sherpa = await import('sherpa-onnx-node');
const { OfflineRecognizer, readWave } = sherpa.default || sherpa;

const rec = new OfflineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    senseVoice: { model: MODEL, useInverseTextNormalization: 1, language: 'auto' },
    tokens: TOKENS,
    numThreads: 4,
    provider: 'cpu',
    debug: 0,
  },
  decodingMethod: 'greedy_search',
});

console.log('=== 用官方参考文本严格评测（模型自带真人录音）===\n');

let totDist = 0, totRef = 0, passed = 0, tested = 0;
const skipped = [];

for (const lg of REF_LANGS) {
  const wav = path.join(TEST_WAVS, lg + '.wav');
  if (!reference[lg]) { skipped.push(lg + '(无参考文本)'); continue; }
  if (!fs.existsSync(wav)) { skipped.push(lg + '(无音频)'); continue; }

  const ref = reference[lg];
  const wave = readWave(wav);
  const st = rec.createStream();
  st.acceptWaveform({ samples: wave.samples, sampleRate: wave.sampleRate });
  rec.decode(st);
  const got = rec.getResult(st).text.trim();

  const byWord = lg === 'en';
  const w = wer(ref, got, byWord);
  totDist += w.distance; totRef += w.refLen; tested++;
  if (w.exact) passed++;

  console.log('--- ' + lg.toUpperCase() + '  (' + (wave.samples.length / wave.sampleRate).toFixed(1) + 's) ---');
  console.log('  真值: ' + ref);
  console.log('  识别: ' + got);
  console.log('  ' + (byWord ? '词' : '字') + '数 ' + w.refLen + '，错误 ' + w.distance +
    '，错误率 ' + (w.rate * 100).toFixed(1) + '%');
  console.log('  ' + (w.exact ? '✅ 逐字一致' : '差异: ' + describeOps(w.ops)));
  console.log('');
}

console.log('===== 总体 =====');
if (skipped.length) console.log('  跳过: ' + skipped.join(', '));
console.log('  语言数 ' + tested + ' / ' + REF_LANGS.length + '，逐字一致 ' + passed + ' / ' + tested);
console.log('  合计 ' + totRef + ' 单位，总错误率 ' + (totRef ? (totDist / totRef * 100).toFixed(2) : 'N/A') + '%');

/* 一个语言都没测到 = 验证失败，绝不能算通过 */
if (tested === 0) {
  console.error('\n❌ 没有任何语言完成评测 —— 准确度未经验证。');
  process.exit(1);
}
if (tested < REF_LANGS.length) {
  console.error('\n⚠ 只测了 ' + tested + ' / ' + REF_LANGS.length + ' 种语言，视为失败。');
  process.exit(1);
}

process.exit(totDist === 0 ? 0 : 1);
