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
import { vadAvailable, detectSpeechSegments, groupSegments, joinChunkTexts } from './lib/vad.js';
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

长音频选项
  --chunk-threshold <秒>   超过这个长度才分块，默认 300
  --chunk <秒>             每块的目标时长，默认 120
  说明：分块切点用 VAD 找**自然停顿**，不会从词中间切断。
        整段识别的内存占用随长度超线性增长（60s→519MB，600s→5.4GB），
        所以长音频默认会自动分块。想强制整段识别（吃内存）设 --chunk-threshold 99999。

示例
  node transcribe.js lecture.mp3
  node transcribe.js ./recordings --lang auto
  node transcribe.js meeting.m4a --json > out.json
  node transcribe.js long-talk.mp3 --chunk 90       # 更小的块 = 更省内存
  node transcribe.js --check

支持的音频格式
  mp3 wav m4a flac ogg aac opus wma mp4 m4b amr
  （非 wav 需要 ffmpeg；安装依赖时已自动装好）

首次使用请先下载模型
  npm run setup
`;

if (has('--help') || has('-h')) { console.log(HELP.trim()); process.exit(0); }

/* ---------------- 语言参数校验与规范化 ----------------
 * 原生库对非法语言码会直接抛 C++ 层错误（Invalid sense-voice-language: 'EN'），
 * 信息晦涩且退出码不友好。这里在 JS 层先兜住，并接受常见写法。
 */
const VALID_LANGS = ['en', 'zh', 'ja', 'ko', 'yue', 'auto'];
const LANG_ALIASES = {
  english: 'en', eng: 'en', 'en-us': 'en', 'en-gb': 'en', 'en_us': 'en', 'en_gb': 'en',
  chinese: 'zh', chi: 'zh', mandarin: 'zh', 'zh-cn': 'zh', 'zh-tw': 'zh', 'zh-hans': 'zh', 'zh-hant': 'zh', cmn: 'zh',
  japanese: 'ja', jpn: 'ja', jp: 'ja',
  korean: 'ko', kor: 'ko', kr: 'ko',
  cantonese: 'yue', canto: 'yue',
  detect: 'auto', '': 'auto', default: 'auto',
  // 中文写法（中文用户很自然会这么输）
  '英语': 'en', '英文': 'en',
  '中文': 'zh', '汉语': 'zh', '普通话': 'zh', '简体中文': 'zh', '繁體中文': 'zh',
  '日语': 'ja', '日文': 'ja', '日本語': 'ja',
  '韩语': 'ko', '韩文': 'ko', '한국어': 'ko',
  '粤语': 'yue', '粵語': 'yue', '广东话': 'yue',
  '自动': 'auto', '检测': 'auto',
};

function normalizeLang(raw) {
  const v = String(raw).trim().toLowerCase();
  if (VALID_LANGS.includes(v)) return { ok: true, lang: v };
  if (LANG_ALIASES[v]) return { ok: true, lang: LANG_ALIASES[v], note: raw + ' → ' + LANG_ALIASES[v] };
  return { ok: false, value: raw };
}

const langArg = opt('--lang', 'en');
const langResult = normalizeLang(langArg);
if (!langResult.ok) {
  console.log('');
  console.log('❌ --lang 的值不受支持: ' + JSON.stringify(langResult.value));
  console.log('');
  console.log('可选值:');
  console.log('   en     英语        zh     中文        ja     日语');
  console.log('   ko     韩语        yue    粤语        auto   自动检测');
  console.log('');
  console.log('也接受常见别名，例如:');
  console.log('   english / en-US / 英语 / 英文          → en');
  console.log('   chinese / zh-CN / 中文 / 普通话         → zh');
  console.log('   japanese / 日语 / 日文 / 日本語         → ja');
  console.log('   korean / 韩语 / 한국어                 → ko');
  console.log('   cantonese / 粤语 / 广东话              → yue');
  console.log('   auto / detect / 自动                   → auto');
  console.log('');
  console.log('例:  node transcribe.js "音频.mp3" --lang zh');
  process.exit(2);
}
const LANG = langResult.lang;
if (langResult.note) console.log('提示: --lang ' + langResult.note + '\n');

const USE_ITN = has('--no-itn') ? 0 : 1;
const AS_JSON = has('--json');
const TO_STDOUT = has('--stdout');
const DO_CHECK = has('--check');

/**
 * 长音频分块参数。
 *
 * 触发阈值：超过 CHUNK_THRESHOLD 秒才分块。设 300s 的理由 ——
 * 实测整段识别的内存占用（16k 单声道）：
 *   60s → 519 MB   300s → 1.7 GB   600s → 5.4 GB
 * 300 秒以内可接受；600s 分块后从 5.4 GB 降到约 1.6 GB，且快 3 倍。
 *
 * 切点方式：**用 VAD 找自然停顿**，不按固定时间切。
 * 固定时间切会把词从中间切断 —— 实测只检出 8/12 句；VAD 切点零丢失（8/8）。
 */
const CHUNK_THRESHOLD = Number(opt('--chunk-threshold', '300')) || 300;
const CHUNK_TARGET = Number(opt('--chunk', '120')) || 120;

const inputs = argv.filter((a, i) =>
  !a.startsWith('--') && argv[i - 1] !== '--lang' &&
  argv[i - 1] !== '--chunk' && argv[i - 1] !== '--chunk-threshold');

/* ---------------- 环境检查 ---------------- */
const needFfmpeg = !has('--test') && collectTargets(inputs).some((f) => path.extname(f).toLowerCase() !== '.wav');
if (reportProblems(checkDeps({ needFfmpeg }))) {
  // reportProblems 已经把该怎么做印在 stdout 上了（走 stdout 才不会在 cmd 里被忽略）
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

/**
 * 只读 WAV 头拿时长，**不把整段读进内存**。
 * 用于判断是否需要分块，避免为了"测个长度"就先吃一份内存。
 */
function wavDuration(file) {
  try {
    const fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(65536);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    fs.closeSync(fd);
    if (n < 44 || head.toString('latin1', 0, 4) !== 'RIFF' || head.toString('latin1', 8, 12) !== 'WAVE') return null;
    let pos = 12, fmt = null, dataSize = null;
    while (pos + 8 <= n) {
      const id = head.toString('latin1', pos, pos + 4);
      const size = head.readUInt32LE(pos + 4);
      if (id === 'fmt ') {
        fmt = { channels: head.readUInt16LE(pos + 10), sampleRate: head.readUInt32LE(pos + 12), bits: head.readUInt16LE(pos + 22) };
      } else if (id === 'data') { dataSize = size; break; }
      pos += 8 + size + (size % 2);
    }
    if (!fmt || dataSize == null || !fmt.channels || !fmt.bits) return null;
    return {
      seconds: dataSize / (fmt.sampleRate * fmt.channels * (fmt.bits / 8)),
      sampleRate: fmt.sampleRate,
      channels: fmt.channels,
    };
  } catch (e) { return null; }
}

function prepare(src) {
  const ext = path.extname(src).toLowerCase();
  if (ext === '.wav') {
    const info = wavDuration(src);
    /* 只有 16kHz / 单声道 / 16-bit PCM 才能真正跳过转换 ——
       sherpa-onnx 的 readWave() 只支持 16-bit PCM WAV。
       漏检位深会让 24-bit / 32-bit 浮点文件直接失败（实测踩过）。 */
    if (info && info.sampleRate === 16000 && info.channels === 1 && info.bits === 16) {
      return { wav: src, temp: false, dur: info.seconds };
    }
  }
  const ffmpeg = resolveFfmpeg();
  if (!ffmpeg) {
    throw new Error('需要 ffmpeg 转换 ' + ext + ' 文件，但未找到。请执行 npm install 或设置 FFMPEG_PATH');
  }
  const out = path.join(TMP_DIR, path.basename(src, ext) + '.' + process.pid + '.16k.wav');
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', src, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', out],
    { stdio: 'pipe', timeout: 300000 });
  const info = wavDuration(out);
  return { wav: out, temp: true, dur: info ? info.seconds : undefined };
}

/** 识别一段采样 */
function decodeSamples(samples, sampleRate) {
  const st = recognizer.createStream();
  st.acceptWaveform({ samples, sampleRate });
  recognizer.decode(st);
  const r = recognizer.getResult(st);
  return {
    text: (r.text || '').trim(),
    lang: (r.lang || '').replace(/[<>|]/g, ''),
    emotion: (r.emotion || '').replace(/[<>|]/g, ''),
    event: (r.event || '').replace(/[<>|]/g, ''),
  };
}

/** 用 ffmpeg 抽取 [start, start+len) 并识别 —— 不把整段读进内存 */
function decodeWindow(wavFile, start, len) {
  const ffmpeg = resolveFfmpeg();
  const seg = path.join(TMP_DIR, path.basename(wavFile) + '.' + process.pid + '.' + start.toFixed(2) + '.seg.wav');
  try {
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error',
      '-ss', start.toFixed(3), '-t', len.toFixed(3),
      '-i', wavFile, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', seg],
      { stdio: 'pipe', timeout: 300000 });
    const w = readWave(seg);
    if (!w.samples.length) return null;
    return decodeSamples(w.samples, w.sampleRate);
  } finally {
    try { fs.unlinkSync(seg); } catch (e) { }
  }
}

async function transcribe(src) {
  const { wav, temp, dur } = prepare(src);
  try {
    const total = dur ?? wavDuration(wav)?.seconds;

    /* 短音频：整段识别（最准） */
    if (total && total <= CHUNK_THRESHOLD) {
      const w = readWave(wav);
      const r = decodeSamples(w.samples, w.sampleRate);
      return { ...r, duration: total, chunks: 1, chunkMethod: 'none' };
    }
    if (!total) {
      const w = readWave(wav);
      const r = decodeSamples(w.samples, w.sampleRate);
      return { ...r, duration: w.samples.length / w.sampleRate, chunks: 1, chunkMethod: 'none' };
    }

    /* 长音频必须分块 —— 整段识别的解码开销随长度**超线性**增长：
       300s → 40s 耗时，600s → 150s+ 耗时，内存 5.4 GB。
       分块后 600s 降到 38s / 1.6 GB（快 4 倍）。

       切点优先用 VAD 找自然停顿；VAD 无结果时退回等分切块。 */
    let groups = [];
    let method = 'none';

    if (vadAvailable()) {
      const full = readWave(wav);
      const segs = await detectSpeechSegments(full.samples, full.sampleRate, {
        maxSpeechDuration: Math.min(CHUNK_TARGET, 30),
      });
      if (segs.length) {
        groups = groupSegments(segs, CHUNK_TARGET, total, 0.3);
        if (groups.length > 1) {
          method = 'vad';
        } else if (!AS_JSON && !TO_STDOUT) {
          /* VAD 找到了语音，但整段就是一块 —— 不能报"未找到语音段" */
          process.stderr.write('    · VAD 认为整段是连续语音（' + segs.length +
            ' 个语音段，未形成多处停顿），改用等分切块\n');
        }
      } else if (!AS_JSON && !TO_STDOUT) {
        process.stderr.write('    · VAD 未检测到语音（可能是音乐或纯噪声），改用等分切块\n');
      }
    }

    if (method === 'none') {
      /* VAD 不可用、没找到语音、或整段只有一块：等分切块。
         等分切会对语音内容造成边界截断（实测丢内容），所以只在
         "VAD 判断不出停顿" 或 "没装 VAD 模型" 时才走这条路 ——
         此时内容要么不是可识别语音，要么本身就是连续语音没有停顿，
         内容损失不是主要矛盾，而内存与耗时是。 */
      const n = Math.max(1, Math.ceil(total / CHUNK_TARGET));
      groups = [];
      for (let i = 0; i < n; i++) {
        groups.push({ start: i * (total / n), end: Math.min(total, (i + 1) * (total / n)), segments: 0 });
      }
      method = vadAvailable() ? 'time-fallback' : 'time-novad';
      if (!AS_JSON && !TO_STDOUT && !vadAvailable()) {
        process.stderr.write('    ⚠ 未安装 VAD 模型，使用等分切块（长语音可能边界截断）\n');
        process.stderr.write('      安装可避免：npm run setup\n');
      }
    }

    /* 按 VAD 切点分块识别 */
    const parts = [];
    const events = new Set();
    let lang = '', emotion = '';
    for (let i = 0; i < groups.length; i++) {
      const g = groups[i];
      const r = decodeWindow(wav, g.start, g.end - g.start);
      if (r) {
        parts.push(r.text);
        if (r.event) events.add(r.event);
        if (!lang && r.lang) lang = r.lang;
        if (!emotion && r.emotion) emotion = r.emotion;
      }
      if (!AS_JSON && !TO_STDOUT) {
        process.stderr.write('    分块 ' + (i + 1) + '/' + groups.length +
          '  ' + g.start.toFixed(1) + '-' + g.end.toFixed(1) + 's  (' + g.segments + ' 个语音段)\n');
      }
    }

    return {
      text: joinChunkTexts(parts, LANG === 'en'),
      lang, emotion,
      event: [...events].join(' '),
      duration: total,
      chunks: groups.length,
      /* 必须回报真实的分块方式 —— 硬编码 'vad' 会让调用方（尤其是 AI）
         误判这次结果的可信度：等分切块可能截断词，VAD 切块不会。 */
      chunkMethod: method,
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
  /* VAD 是可选组件：没有它也能用，只是长音频会整段载入内存 */
  if (vadAvailable()) {
    console.log('    VAD 模型    : ✅ 已装（长音频按自然停顿分块）');
  } else {
    console.log('    VAD 模型    : ⚠ 未装 —— 超过 ' + CHUNK_THRESHOLD + 's 的音频会整段载入内存');
    console.log('                  安装：npm run setup');
  }
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
    const r = await transcribe(path.join(demoDir, demo[0]));
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
    const r = await transcribe(f);
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
