/* ============================================================
 * 准确度评测：用模型自带的官方参考文本作真值，逐字比对
 *
 * 用法：node tests/benchmark.js
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { MODEL, TOKENS, TEST_WAVS } from '../lib/paths.js';
import { wer, describeOps } from '../lib/wer.js';

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

if (!fs.existsSync(TEST_WAVS)) {
  console.error('缺少测试音频目录: ' + TEST_WAVS);
  process.exit(1);
}

console.log('=== 用官方参考文本严格评测（模型自带真人录音）===\n');

const LANGS = ['en', 'zh', 'ja', 'ko', 'yue'];
let totDist = 0, totRef = 0, passed = 0, tested = 0;

for (const lg of LANGS) {
  const wav = path.join(TEST_WAVS, lg + '.wav');
  const refFile = path.join(TEST_WAVS, lg + '.txt');
  if (!fs.existsSync(wav) || !fs.existsSync(refFile)) { console.log(lg + ': 缺文件，跳过'); continue; }

  const ref = fs.readFileSync(refFile, 'utf8').trim();
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
console.log('  语言数 ' + tested + '，逐字一致 ' + passed + ' / ' + tested);
console.log('  合计 ' + totRef + ' 单位，总错误率 ' + (totRef ? (totDist / totRef * 100).toFixed(2) : 'N/A') + '%');
process.exit(totDist === 0 ? 0 : 1);
