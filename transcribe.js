#!/usr/bin/env node
/* ============================================================
 * asr-local —— 本地离线音频转写
 *
 * 引擎：sherpa-onnx + SenseVoice int8（阿里 FunAudioLLM，中/英/日/韩/粤）
 * 特点：完全离线。不需要登录、不需要 API Key、不联网。
 *
 * 用法：
 *   node transcribe.js <文件或目录...>      转写
 *   node transcribe.js --check              环境与准确度自检
 *   node transcribe.js --lang auto <文件>   自动检测语言（默认 en）
 *   node transcribe.js --json <文件>        JSON 输出
 *   node transcribe.js --help               查看全部选项
 * ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import {
  ROOT, MODEL, TOKENS, TEST_WAVS, TMP_DIR,
  resolveFfmpeg, checkDeps, reportProblems, collectTargets,
  loadReference, REF_LANGS,
} from './lib/paths.js';
import { wer, describeOps } from './lib/wer.js';

const VERSION = '1.0.0';

/* ---------------- 参数 ---------------- */
const argv = process.argv.slice(2);
const has = (n) => argv.includes(n);
const opt = (n, d) => { const i = argv.indexOf(n); return i >= 0 && argv[i + 1] ? argv[i + 1] : d; };

if (has('--version') || has('-v')) { console.log(VERSION); process.exit(0); }

const HELP = `
asr-local ${VERSION} —— 本地离线音频转写（sherpa-onnx + SenseVoice）

用法
  node transcribe.js <文件或目录...> [选项]

选项
  --lang <code>   识别语言：en(默认) / zh / ja / ko / yue / auto
  --no-itn        关闭数字规范化（保留 "fifty-six" 而不是 "56"）
  --json          结果以 JSON 输出（供程序消费）
  --stdout        只打印到标准输出，不写 .txt 文件
  --check         环境与准确度自检
  --test          用模型自带样例测试
  --help, -h      显示本帮助
  --version, -v   显示版本

示例
  node transcribe.js lecture.mp3
  node transcribe.js ./recordings --lang auto
  node transcribe.js meeting.m4a --json > out.json
  node transcribe.js --check

支持的音频格式
  mp3 wav m4a flac ogg aac opus wma mp4 m4b amr
  （非 wav 需要 ffmpeg；安装依赖时已自动装好）

首次使用请先下载模型
  npm run setup
`;

if (has('--help') || has('-h')) { console.log(HELP.trim()); process.exit(0); }

const LANG = opt('--lang', 'en');
const USE_ITN = has('--no-itn') ? 0 : 1;
const AS_JSON = has('--json');
const TO_STDOUT = has('--stdout');
const DO_CHECK = has('--check');
const inputs = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--lang');

/* ---------------- 环境检查 ---------------- */
const needFfmpeg = !has('--test') && collectTargets(inputs).some((f) => path.extname(f).toLowerCase() !== '.wav');
if (reportProblems(checkDeps({ needFfmpeg }))) {
  console.error('提示：首次使用请依次执行');
  console.error('  npm install');
  console.error('  npm run setup      # 下载模型（约 155 MB，自动校验 SHA256）\n');
  process.exit(1);
}

/* ---------------- 加载识别器 ---------------- */
let sherpa;
try {
  sherpa = await import('sherpa-onnx-node');
} catch (e) {
  console.error('❌ 无法加载 sherpa-onnx-node: ' + e.message);
  console.error('   执行 npm install 重装依赖。');
  process.exit(1);
}
const { OfflineRecognizer, readWave } = sherpa.default || sherpa;

function makeRecognizer(language) {
  return new OfflineRecognizer({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      senseVoice: { model: MODEL, useInverseTextNormalization: USE_ITN, language },
      tokens: TOKENS,
      numThreads: Math.max(2, Math.min(8, os.cpus().length)),
      provider: 'cpu',
      debug: 0,
    },
    decodingMethod: 'greedy_search',
  });
}

let recognizer;
try {
  recognizer = makeRecognizer(LANG);
} catch (e) {
  console.error('❌ 识别器初始化失败: ' + e.message);
  console.error('   模型文件可能损坏，删除 models/ 后重新执行 npm run setup');
  process.exit(1);
}

/* ---------------- 音频准备（统一转 16k 单声道 WAV） ---------------- */
fs.mkdirSync(TMP_DIR, { recursive: true });

function prepare(src) {
  const ext = path.extname(src).toLowerCase();
  if (ext === '.wav') {
    try {
      const w = readWave(src);
      if (w.sampleRate === 16000) return { wav: src, temp: false, dur: w.samples.length / w.sampleRate };
    } catch (e) { /* 交给 ffmpeg 处理 */ }
  }
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) {
    throw new Error('需要 ffmpeg 转换 ' + ext + ' 文件，但未找到。请执行 npm install 或设置 FFMPEG_PATH');
  }
  const out = path.join(TMP_DIR, path.basename(src, ext) + '.' + process.pid + '.16k.wav');
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', out],
    { stdio: 'pipe', timeout: 300000 });
  return { wav: out, temp: true };
}

function transcribe(src) {
  const { wav, temp, dur } = prepare(src);
  try {
    const wave = readWave(wav);
    const st = recognizer.createStream();
    st.acceptWaveform({ samples: wave.samples, sampleRate: wave.sampleRate });
    recognizer.decode(st);
    const r = recognizer.getResult(st);
    return {
      text: (r.text || '').trim(),
      lang: (r.lang || '').replace(/[<>|]/g, ''),
      emotion: (r.emotion || '').replace(/[<>|]/g, ''),
      event: (r.event || '').replace(/[<>|]/g, ''),
      duration: dur || wave.samples.length / wave.sampleRate,
    };
  } finally {
    if (temp) { try { fs.unlinkSync(wav); } catch (e) {} }
  }
}

/* ============================================================
 * --check：环境 + 准确度自检
 * ============================================================ */
if (DO_CHECK) {
  console.log('=========== asr-local 自检 ===========\n');
  const t0 = Date.now();

  console.log('[1] 环境');
  console.log('    平台        : ' + process.platform + '-' + process.arch);
  console.log('    Node        : ' + process.version);
  console.log('    模型        : ' + (fs.statSync(MODEL).size / 1048576).toFixed(1) + ' MB');
  const ff = resolveFfmpeg();
  console.log('    ffmpeg      : ' + (ff ? ff : '未找到（只能处理 wav）'));
  console.log('    引擎版本    : sherpa-onnx ' + ((sherpa.default || sherpa).version || '?'));
  console.log('    识别器就绪  : ' + ((Date.now() - t0) / 1000).toFixed(2) + 's');

  console.log('\n[2] 五语言准确度（对照官方参考文本）');
  let accFailed = false;
  const reference = loadReference();
  if (reference.error) {
    console.log('    ❌ ' + reference.error);
    accFailed = true;
  } else if (!fs.existsSync(TEST_WAVS)) {
    console.log('    ❌ 缺少样例音频目录: ' + TEST_WAVS);
    console.log('       模型包未正确解压。执行 npm run setup 重新安装。');
    accFailed = true;
  } else {
    const autoRec = LANG === 'auto' ? recognizer : makeRecognizer('auto');
    let totD = 0, totR = 0, allExact = true, n = 0, skipped = [];
    for (const lg of REF_LANGS) {
      const wav = path.join(TEST_WAVS, lg + '.wav');
      if (!reference[lg]) { skipped.push(lg + '(无参考文本)'); continue; }
      if (!fs.existsSync(wav)) { skipped.push(lg + '(无音频)'); continue; }
      const wave = readWave(wav);
      const st = autoRec.createStream();
      st.acceptWaveform({ samples: wave.samples, sampleRate: wave.sampleRate });
      autoRec.decode(st);
      const got = autoRec.getResult(st).text.trim();
      const w = wer(reference[lg], got, lg === 'en');
      totD += w.distance; totR += w.refLen; n++;
      if (!w.exact) allExact = false;
      console.log('    ' + lg.toUpperCase() + '  ' + (w.rate * 100).toFixed(1) + '% 错误  ' +
        (w.exact ? '✅ 逐字一致' : '差异: ' + describeOps(w.ops)));
    }
    console.log('    ------------------------------------');
    if (skipped.length) console.log('    跳过: ' + skipped.join(', '));
    if (n === 0) {
      // 关键：一个语言都没测到，绝不能报"通过"——早期版本在这里误报成功
      console.log('    ❌ 没有任何语言完成测试，准确度未经验证');
      accFailed = true;
    } else {
      console.log('    ' + n + ' 种语言，' + totR + ' 单位，错误率 ' +
        (totD / totR * 100).toFixed(2) + '%  ' + (allExact ? '✅ 全部通过' : '⚠ 有差异'));
      if (!allExact || n < REF_LANGS.length) accFailed = true;
    }
  }

  console.log('\n[3] 端到端（mp3 → wav → 转写）');
  const demoDir = path.join(ROOT, 'demo');
  const demo = fs.existsSync(demoDir)
    ? fs.readdirSync(demoDir).filter((f) => /\.(mp3|m4a|flac)$/i.test(f))
        .map((f) => ({ f, size: fs.statSync(path.join(demoDir, f)).size }))
        .sort((a, b) => b.size - a.size)
        .map((x) => x.f)
    : [];
  if (!demo.length) {
    console.log('    ⚠ demo/ 下没有音频，跳过（可放任意音频进去再试）');
  } else if (!resolveFfmpeg() && !/\.wav$/i.test(demo[0])) {
    console.log('    ⚠ 无 ffmpeg，跳过');
  } else {
    const t1 = Date.now();
    const r = transcribe(path.join(demoDir, demo[0]));
    const el = (Date.now() - t1) / 1000;
    console.log('    ' + demo[0] + '  ' + r.duration.toFixed(1) + 's 音频 / ' + el.toFixed(2) + 's 识别' +
      '  (' + (r.duration / el).toFixed(0) + '× 实时)');
    console.log('    ' + r.text.slice(0, 100) + (r.text.length > 100 ? '…' : ''));
  }

  if (accFailed) {
    console.log('\n❌ 自检未通过：准确度验证有问题，详见上面 [2] 段。');
    process.exit(1);
  }
  console.log('\n完成，全部通过。');
  process.exit(0);
}

/* ============================================================
 * 正常转写
 * ============================================================ */
const targets = has('--test')
  ? (fs.existsSync(TEST_WAVS)
      ? fs.readdirSync(TEST_WAVS).filter((f) => f.endsWith('.wav')).map((f) => path.join(TEST_WAVS, f))
      : [])
  : collectTargets(inputs);

/* 输入路径不存在时明确报错，不要静默当成"没有输入" */
if (targets.missing && targets.missing.length) {
  console.error('❌ 找不到以下路径：');
  for (const m of targets.missing) console.error('   ' + m);
  console.error('');
}

if (!targets.length) {
  // 给了输入但一个都不存在 → 这是错误，退出码必须非零
  if (targets.missing && targets.missing.length) {
    console.error('没有可处理的音频文件。');
    process.exit(1);
  }
  // 完全没给输入 → 打印用法，属正常行为
  console.log(HELP.trim());
  process.exit(0);
}

if (!AS_JSON) {
  console.log('引擎: SenseVoice int8 | 语言: ' + LANG + ' | ITN: ' + USE_ITN + ' | 待处理: ' + targets.length + ' 个\n');
}

const results = [];
let totalAudio = 0, totalTime = 0;

for (const f of targets) {
  const name = path.basename(f);
  const t0 = Date.now();
  try {
    const r = transcribe(f);
    const el = (Date.now() - t0) / 1000;
    totalAudio += r.duration; totalTime += el;
    results.push({ file: f, name, ok: true, ...r, elapsed: el });

    if (AS_JSON) continue;
    if (!TO_STDOUT) console.log('======== ' + name + '  (' + r.duration.toFixed(1) + 's 音频 / ' + el.toFixed(2) + 's 识别) ========');
    console.log(r.text);
    if (!TO_STDOUT) console.log('');
    if (!TO_STDOUT) fs.writeFileSync(f.replace(/\.[^.]+$/, '') + '.txt', r.text, 'utf8');
  } catch (e) {
    results.push({ file: f, name, ok: false, error: e.message });
    if (!AS_JSON) console.log('======== ' + name + ' ========\n[失败] ' + e.message + '\n');
  }
}

if (AS_JSON) {
  console.log(JSON.stringify({ lang: LANG, itn: USE_ITN, results }, null, 2));
} else {
  const ok = results.filter((r) => r.ok);
  console.log('=== 完成: 成功 ' + ok.length + ' / ' + results.length + ' ===');
  if (totalAudio > 0 && totalTime > 0) {
    console.log('    音频总长 ' + totalAudio.toFixed(1) + 's，识别 ' + totalTime.toFixed(2) + 's（' +
      (totalAudio / totalTime).toFixed(1) + '× 实时）');
  }
  if (ok.length > 1 && !TO_STDOUT) {
    const all = ok.map((r) => '## ' + r.name + '\n\n' + r.text).join('\n\n');
    fs.writeFileSync(path.join(ROOT, 'transcripts-all.txt'), all, 'utf8');
    console.log('    汇总: transcripts-all.txt');
  }
  if (ok.length && !TO_STDOUT) console.log('    每个音频旁已生成同名 .txt');
}

process.exitCode = results.some((r) => !r.ok) ? 1 : 0;
