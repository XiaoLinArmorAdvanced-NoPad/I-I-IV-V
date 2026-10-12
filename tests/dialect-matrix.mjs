/* ============================================================
 * 方言与跨语言混淆矩阵
 *
 *   node tests/dialect-matrix.mjs
 *
 * 用模型自带的**真人录音**（5 个语种，含粤语方言），分别用 6 种语言码识别，
 * 看"用错语言码"会把方言/外语破坏到什么程度 —— 这是可量化的方言鲁棒性证据。
 *
 * 注意：这里测的是**方言被误设语言码**时的表现，不是方言本身的识别率。
 *      （后者需要真实方言语音素材，本机无法合成。）
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { MODEL, TOKENS, TEST_WAVS, TMP_DIR, loadReference, REF_LANGS } from '../lib/paths.js';
import { wer, describeOps } from '../lib/wer.js';

/** 测试产物统一写到临时目录，绝不落进仓库 */
const RESULTS_DIR = path.join(TMP_DIR, 'results');
fs.mkdirSync(RESULTS_DIR, { recursive: true });

const sherpa = await import('sherpa-onnx-node');
const { OfflineRecognizer, readWave } = sherpa.default || sherpa;

const ref = loadReference();
if (ref.error) { console.error(ref.error); process.exit(1); }

const LANGS = ['en', 'zh', 'ja', 'ko', 'yue', 'auto'];
const recs = {};
const recFor = (l) => (recs[l] = recs[l] || new OfflineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: {
    senseVoice: { model: MODEL, useInverseTextNormalization: 0, language: l },
    tokens: TOKENS, numThreads: 4, provider: 'cpu', debug: 0,
  },
  decodingMethod: 'greedy_search',
}));

const run = (wav, lang) => {
  const w = readWave(wav);
  const r = recFor(lang);
  const st = r.createStream();
  st.acceptWaveform({ samples: w.samples, sampleRate: w.sampleRate });
  r.decode(st);
  return r.getResult(st).text.trim();
};

console.log('=== 方言 / 跨语言混淆矩阵 ===\n');
console.log('行 = 音频真实语种，列 = 使用的 --lang 值');
console.log('格子里是"错误率"（英文按词，中日韩粤按字）\n');

const header = '音频\\lang'.padEnd(12) + LANGS.map((l) => l.padStart(9)).join('');
console.log(header);
console.log('-'.repeat(header.length));

const matrix = {};
for (const audioLang of REF_LANGS) {
  const wav = path.join(TEST_WAVS, audioLang + '.wav');
  if (!fs.existsSync(wav)) { console.log(audioLang + ' 缺音频'); continue; }
  const truth = ref[audioLang];
  if (!truth) { console.log(audioLang + ' 缺参考文本'); continue; }
  const byWord = audioLang === 'en';

  const row = {};
  const cells = [];
  for (const useLang of LANGS) {
    try {
      const got = run(wav, useLang);
      const w = wer(truth, got, byWord);
      row[useLang] = { rate: w.rate, text: got, exact: w.exact };
      cells.push((w.rate * 100).toFixed(0).padStart(8) + '%');
    } catch (e) {
      row[useLang] = { error: e.message };
      cells.push('   ERR'.padStart(9));
    }
  }
  matrix[audioLang] = row;
  console.log(audioLang.toUpperCase().padEnd(12) + cells.join(''));
}

/* 每个音频语种，哪种 --lang 最好 */
console.log('\n=== 最佳语言码推荐 ===\n');
for (const audioLang of REF_LANGS) {
  const row = matrix[audioLang];
  if (!row) continue;
  const valid = Object.entries(row).filter(([, v]) => !v.error);
  valid.sort((a, b) => a[1].rate - b[1].rate);
  const best = valid[0];
  const auto = row.auto;
  console.log('  ' + audioLang.toUpperCase() + ' 音频:');
  console.log('      最佳: --lang ' + best[0] + '  (' + (best[1].rate * 100).toFixed(1) + '%)');
  if (auto && !auto.error) {
    console.log('      auto: ' + (auto.rate * 100).toFixed(1) + '%' +
      (auto.rate <= best[1].rate + 0.001 ? '  ← auto 与最佳持平，可放心用 auto' : '  ← 比最佳差'));
  }
}

/* 粤语专项：方言被当普通话处理会怎样 */
console.log('\n=== 粤语方言专项（yue.wav 真人录音）===\n');
{
  const row = matrix.yue;
  if (row) {
    console.log('  真值: ' + ref.yue);
    for (const l of LANGS) {
      if (row[l].error) continue;
      const mark = row[l].exact ? '✅ 逐字一致' : '✗ 错误 ' + (row[l].rate * 100).toFixed(0) + '%';
      console.log('  --lang ' + l.padEnd(5) + ' ' + mark.padEnd(16) + JSON.stringify(row[l].text.slice(0, 40)));
    }
    const zhRow = row.zh, yueRow = row.yue;
    if (zhRow && yueRow && !zhRow.error && !yueRow.error) {
      console.log('\n  结论: 粤语用 --lang zh（当普通话处理）错误率 ' + (zhRow.rate * 100).toFixed(0) +
        '%，用 --lang yue 为 ' + (yueRow.rate * 100).toFixed(0) + '%');
      if (zhRow.rate > yueRow.rate) {
        console.log('        → 方言必须指定正确的语言码，否则准确度明显下降。');
      } else {
        console.log('        → 本例中语言码影响不大，但不代表所有方言情况。');
      }
    }
  }
}

fs.writeFileSync(path.join(RESULTS_DIR, 'dialect-matrix-result.json'), JSON.stringify(matrix, null, 2), 'utf8');
console.log('\n明细写入 ' + path.join(RESULTS_DIR, 'dialect-matrix-result.json'));
