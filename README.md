# asr-local

**Offline audio transcription. No login, no API key, no network.**

**Backed by 蓝色大肥鱼 DeepSeek.**
**Most of this README was written by DeepSeek too.**
**If you can't figure out the install, just throw the link or the files at an AI.**

[中文文档](README.zh-CN.md) · [Getting started (中文, Windows)](docs/GETTING-STARTED-zh.md) · [实战指南](docs/USAGE-zh.md)

```bash
node transcribe.js audio.mp3
```

> **First time here?** See the [Windows getting-started guide](docs/GETTING-STARTED-zh.md)
> (Chinese) — four copy-paste steps, no prior command-line experience needed.
> To verify an install in one command: `npm run check`

Powered by [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) + [SenseVoice](https://github.com/FunAudioLLM/SenseVoice) (Alibaba FunAudioLLM). Runs entirely on your machine — after the one-time model download, **nothing leaves your computer**.

---

## 🤖 For AI agents / 给 AI 的说明

**This repo does not ship the model.** It is 229 MB, so it is downloaded by `setup/download-model.js` on first run. Until that finishes, the CLI has no transcription ability at all.

If you are an AI assistant asked to set this up and transcribe something, run exactly this:

```bash
git clone https://github.com/XiaoLinArmorAdvanced-NoPad/I-I-IV-V.git
cd I-I-IV-V
npm install        # native engine + ffmpeg, ~100 MB, platform-matched automatically
npm run setup      # downloads the 229 MB model, verifies SHA256
npm run check      # must print "5 种语言 ... 0.00% 错误" — if not, stop and debug
node transcribe.js "/absolute/path/to/audio.mp3"
```

Then read the `.txt` written next to the audio file (or use `--json` for machine-readable output).

Notes for the agent:

- `npm run setup` tries a direct GitHub connection first, then falls back through mirrors — it works behind restrictive networks.
- Transcribed text lands in `<audio>.txt`; multiple inputs also get aggregated into `transcripts-all.txt`.
- **Input must be speech, not music.** Singing is badly mis-transcribed (the model reports `event: BGM` when it detects music — treat that as a low-confidence signal).
- For non-English audio pass `--lang <zh|ja|ko|yue|auto>`; the default is `en`.

**Never hand the repo link to a chat-only LLM and expect transcription** — it has no shell and cannot receive audio. This only works on something with a real command-line environment.

---

## Why this exists

Most speech-to-text options require either an API key, a cloud upload, or a heavyweight Python + PyTorch stack. This is a single Node.js project that:

- **runs fully offline** — no network calls at inference time
- **needs no account or key**
- **is fast** — 25–90× realtime on CPU
- **handles 5 languages** — English, Chinese, Japanese, Korean, Cantonese
- **has verified accuracy** — 0.00% error on the model's official reference recordings

It was originally built to work through listening-comprehension homework under a restricted network where HuggingFace and GitHub were unreachable — hence the mirror-aware installer.

---

## Requirements

- **Node.js ≥ 18**
- **~400 MB free disk** (228 MB model + ~100 MB native binaries)
- No GPU needed — CPU only

---

## Install

```bash
git clone https://github.com/XiaoLinArmorAdvanced-NoPad/I-I-IV-V.git
cd I-I-IV-V
npm install          # native engine + ffmpeg (platform-matched automatically)
npm run setup        # download the 228 MB model (SHA256-verified)
npm run check        # verify: environment + accuracy + end-to-end
```

`npm install` pulls the right native binary for your platform automatically
(Windows / macOS / Linux, x64 / arm64) via npm `optionalDependencies`.

`npm run setup` downloads the model from a GitHub release. It tries a direct
connection first, then falls back through mirrors — useful behind restrictive
networks. Files are verified against official SHA256 checksums.

---

## Usage

```bash
# single file
node transcribe.js lecture.mp3

# whole directory
node transcribe.js ./recordings

# auto-detect language (default is English)
node transcribe.js interview.m4a --lang auto

# JSON output for scripting
node transcribe.js meeting.mp3 --json > meeting.json

# print only, don't write .txt files
node transcribe.js --stdout note.wav

# keep number words as words ("fifty-six" instead of "56")
node transcribe.js --no-itn lecture.mp3
```

Output: a `.txt` next to each input; `transcripts-all.txt` when multiple files.

### Options

| Option | Description |
|---|---|
| `--lang <code>` | `en` (default) · `zh` · `ja` · `ko` · `yue` · `auto` |
| `--no-itn` | Disable inverse text normalization |
| `--json` | Machine-readable output |
| `--stdout` | Print only, no files written |
| `--check` | Environment + accuracy self-test |
| `--test` | Transcribe the model's bundled samples |
| `--help`, `--version` | Standard CLI flags |

### Supported formats

`mp3` `wav` `m4a` `flac` `ogg` `aac` `opus` `wma` `mp4` `m4b` `amr`

Non-WAV input is converted to 16 kHz mono internally via ffmpeg.

---

## Measured accuracy

Validated against the model's **official reference transcripts** — real human
recordings with published ground truth, not self-reported estimates:

| Lang | Reference = Output | Units | Errors |
|:---:|---|:---:|:---:|
| EN | The tribal chieftain called for the boy and presented him with 50 pieces of code. | 15 words | **0** |
| ZH | 开饭时间早上9点至下午5点。 | 13 chars | **0** |
| JA | うちの中学は弁当制で持っていきない場合は50円の学校販売のパンを買う。 | 34 chars | **0** |
| KO | 조금만 생각을 하면서 살면 훨씬 편할 거야. | 17 chars | **0** |
| YUE | 呢几个字都表达唔到我想讲嘅意思。 | 15 chars | **0** |

**94 units, 0 errors, all five character-for-character identical.**
Reproduce with `npm run check` or `node tests/benchmark.js`.

### Speed

| Audio | Duration | Transcribe | Ratio |
|---|---:|---:|---:|
| Real dialogue | 130.9 s | 4.94 s | 27× |
| Real dialogue | 114.8 s | 4.05 s | 28× |
| Human sample | 7.2 s | 0.08 s | 90× |

CPU only, `numThreads = min(8, cores)`.

---

## Known limitations

Being honest about where it breaks:

1. **Chinese proper nouns in pinyin are the worst case.**
   In testing, 华罗庚 (Hua Luogeng) came out as `Xin Jing run`, `Chun Jing run`,
   and `Qin Jing run` — three different spellings. Don't trust name spellings; reconstruct by sound.
2. **Speaker turns are not separated.** Output is one continuous text block.
3. **No sentence punctuation between utterances.** In long dialogues two speakers'
   words can run together. This is the single most common cause of misreading a transcript.
4. **Number formatting** — with ITN on, `fifty-six` becomes `56`. Use `--no-itn` if you need the words.
5. **Long audio is auto-chunked (VAD-anchored).** Above 300 s the audio is split at
   natural pauses so memory stays bounded (600 s: 5.4 GB → 1.6 GB, and 3× faster).
   Fixed-time splitting was tried first and **loses content** — it cuts mid-word.
6. **No diarization, no punctuation restoration** — sherpa-onnx ships models for both
   (`OfflineSpeakerDiarization`, `OfflinePunctuation`) but they are not wired up here.
   (So all of that is on you to build. UwU)

### When it breaks — measured, not guessed

Full data and reproduction commands: **[docs/ACCURACY-zh.md](docs/ACCURACY-zh.md)**

| Condition | Word/char error | Verdict |
|---|:---:|---|
| Clean human speech, `--lang` default | **0.00%** | 94 units across 5 languages, all identical |
| Signal-to-noise ≈ 20 dB | 6.7% | starts degrading |
| Signal-to-noise ≈ 15 dB | 20% | unreliable |
| Signal-to-noise ≈ 0 dB | 33% | unusable |
| Light reverb | 6.7% | acceptable |
| **Two people talking at once** | — | **only one speaker's words come out** |
| **Singing** | — | **badly mis-transcribed**; `--json` reports `event: BGM` |
| Chinese dialects other than Cantonese | — | **no separate language code; treated as Mandarin** |

**The most dangerous failure mode**: at low SNR the model does not emit garbage — it emits
*plausible* words. `50 pieces of code` becomes `50 pieces of gold`, then `50 pieces of food`.
Errors are fluent and grammatically correct, so they are very hard to spot by reading.

> **For AI agents**: never treat a transcript as ground truth. Numbers, names, amounts and
> dates must be cross-checked. Warn the user when the input is music, multi-speaker,
> heavily accented, or noisy.

---

## Project layout

```
I-I-IV-V/
├─ transcribe.js               CLI entry point
├─ lib/
│  ├─ paths.js                 cross-platform path & dependency resolution
│  ├─ wer.js                   word/char error rate + diff backtracking
│  └─ vad.js                   VAD-anchored chunking for long audio
│  └─ sensevoice-reference.json  official reference transcripts (ground truth)
├─ setup/
│  ├─ download-model.js        model installer (mirror fallback + SHA256)
│  └─ download-model-modelscope.js   fallback source
│  ├─ vad.test.js               VAD chunking correctness
│  ├─ wer.test.js              unit tests (no model needed)
│  ├─ links.test.js            docs link + anchor checker
│  ├─ reference.test.js        ground-truth data integrity
│  ├─ benchmark.js             5-language accuracy vs official ground truth
│  ├─ itn.test.js              number-normalization behaviour
│  ├─ robustness.test.js       61 edge cases: noise, clipping, corrupt files...
│  ├─ degradation.mjs          noise / accent / acoustics degradation curves
│  ├─ dialect-matrix.mjs       cross-language confusion matrix
│  └─ e2e-test.js              full pipeline: TTS → MP3 → transcribe
├─ docs/
│  ├─ GETTING-STARTED-zh.md    zero-experience Windows walkthrough
│  ├─ ACCURACY-zh.md           measured accuracy + when it breaks
│  ├─ USAGE-zh.md              实战指南（做听力作业流程）
│  └─ ANSWERS-zh.md            worked example: 12 listening questions
├─ models/                     (gitignored — created by npm run setup)
└─ demo/                       (gitignored — put your own audio here)
```

---

## Troubleshooting

**`运行环境不完整` / `environment incomplete`**

```bash
npm install && npm run setup
```

**Model download fails**

All mirrors blocked? Download manually and place in `.cache/`:

```
https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2
```

Or set a proxy:

```bash
export HTTPS_PROXY=http://127.0.0.1:7890
```

**`Could not find sherpa-onnx-node`** (Linux/macOS)

The native library path may need exporting:

```bash
export LD_LIBRARY_PATH=$(pwd)/node_modules/sherpa-onnx-linux-x64:$LD_LIBRARY_PATH   # Linux
export DYLD_LIBRARY_PATH=$(pwd)/node_modules/sherpa-onnx-darwin-arm64:$DYLD_LIBRARY_PATH  # macOS
```

**ffmpeg not found**

```bash
npm install                          # reinstalls @ffmpeg-installer
export FFMPEG_PATH=/usr/bin/ffmpeg   # or point at a system ffmpeg
```

---

## Contributing

Issues and PRs welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).
The most valuable additions right now: **speaker diarization**,
**punctuation restoration**, and **VAD-based chunking for long audio**.

---

## License

[MIT](LICENSE) for the code.

Bundled at runtime (not in this repo): sherpa-onnx (Apache-2.0),
SenseVoice model weights (Apache-2.0), FFmpeg (LGPL/GPL).
See [LICENSE](LICENSE) for full third-party notices.
