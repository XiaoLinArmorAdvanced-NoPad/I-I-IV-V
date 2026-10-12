# asr-local

**完全离线的音频转写。不需要登录、不需要 API Key、不联网。**

[English](README.md) · [新手入门](docs/GETTING-STARTED-zh.md) · [实战指南](docs/USAGE-zh.md)

```bash
node transcribe.js 音频.mp3
```

> **第一次用？** 看 [新手入门（Windows）](docs/GETTING-STARTED-zh.md) ——
> 完全没碰过命令行也能跟着做完，四步出结果。
> 想要一句话验收安装是否成功：`npm run check`

引擎是 [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) + [SenseVoice](https://github.com/FunAudioLLM/SenseVoice)（阿里 FunAudioLLM）。
模型下载完之后**全程本地计算，音频不出你的电脑**。

---

## 为什么做这个

常见的语音转写方案要么需要 API Key，要么要把音频传到云端，要么得装一整套 Python + PyTorch。这个项目是一个纯 Node.js 方案：

- **完全离线** —— 推理阶段零网络请求
- **不需要账号或密钥**
- **快** —— CPU 上 25–90× 实时
- **支持 5 种语言** —— 中、英、日、韩、粤
- **准确度经过验证** —— 用模型官方参考文本比对，0.00% 错误

它最初是为了在**受限网络环境**下做听力作业而写的——当时 HuggingFace 和 GitHub 都不可达，
所以安装脚本内置了镜像回退。

---

## 环境要求

- **Node.js ≥ 18**
- **约 400 MB 磁盘**（模型 228 MB + 原生二进制约 100 MB）
- **不需要 GPU**，纯 CPU

---

## 安装

```bash
git clone https://github.com/XiaoLinArmorAdvanced-NoPad/I-I-IV-V.git
cd I-I-IV-V
npm install          # 装原生引擎 + ffmpeg（自动匹配你的平台）
npm run setup        # 下载 228 MB 模型（自动校验 SHA256）
npm run check        # 自检：环境 + 准确度 + 端到端
```

`npm install` 会通过 npm 的 `optionalDependencies` 自动拉取对应平台的原生二进制
（Windows / macOS / Linux，x64 / arm64 都支持）。

`npm run setup` 先试直连 GitHub，失败则依次尝试镜像——受限网络下也能装上。
下载后会用官方 SHA256 校验完整性。

---

## 用法

```bash
# 单个文件
node transcribe.js 讲座.mp3

# 整个目录
node transcribe.js ./录音

# 自动检测语言（默认英语）
node transcribe.js 访谈.m4a --lang auto

# JSON 输出，供脚本消费
node transcribe.js 会议.mp3 --json > 会议.json

# 只打印，不写 .txt
node transcribe.js --stdout 备忘.wav

# 保留数字原词（"fifty-six" 而不是 "56"）
node transcribe.js --no-itn 讲座.mp3
```

输出：每个音频旁生成同名 `.txt`；多文件时额外汇总到 `transcripts-all.txt`。

### 选项

| 选项 | 说明 |
|---|---|
| `--lang <code>` | `en`（默认）· `zh` · `ja` · `ko` · `yue` · `auto` |
| `--no-itn` | 关闭数字规范化 |
| `--json` | 输出 JSON |
| `--stdout` | 只打印，不写文件 |
| `--check` | 环境与准确度自检 |
| `--test` | 转写模型自带样例 |
| `--help` / `--version` | 标准 CLI 参数 |

### 支持格式

`mp3` `wav` `m4a` `flac` `ogg` `aac` `opus` `wma` `mp4` `m4b` `amr`

非 wav 格式内部用 ffmpeg 转成 16 kHz 单声道。

---

## 实测准确度

用模型自带的**官方参考文本**做真值——真人录音 + 公开的标准答案，不是我自己的估计：

| 语言 | 真值 = 输出 | 单位数 | 错误 |
|:---:|---|:---:|:---:|
| EN | The tribal chieftain called for the boy and presented him with 50 pieces of code. | 15 词 | **0** |
| ZH | 开饭时间早上9点至下午5点。 | 13 字 | **0** |
| JA | うちの中学は弁当制で持っていきない場合は50円の学校販売のパンを買う。 | 34 字 | **0** |
| KO | 조금만 생각을 하면서 살면 훨씬 편할 거야. | 17 字 | **0** |
| YUE | 呢几个字都表达唔到我想讲嘅意思。 | 15 字 | **0** |

**合计 94 个单位，0 错误，五段全部逐字一致。**
用 `npm run check` 或 `node tests/benchmark.js` 可以复现。

### 速度

| 音频 | 时长 | 识别耗时 | 倍率 |
|---|---:|---:|---:|
| 真实对话 | 130.9 s | 4.94 s | 27× |
| 真实对话 | 114.8 s | 4.05 s | 28× |
| 真人样例 | 7.2 s | 0.08 s | 90× |

纯 CPU，线程数 `min(8, 核数)`。

---

## 已知局限（据实说明）

1. **中文人名拼音是最弱的一环。**
   实测「华罗庚」被转成 `Xin Jing run`、`Chun Jing run`、`Qin Jing run` **三种不同拼法**。
   不要采信人名的拼写，按发音回推。
2. **不区分说话人。** 输出是一整段连续文本。
3. **句间没有标点分隔。** 长对话里两个人的话会粘在一起——
   这是**最容易导致误读转写**的一点。
4. **数字格式** —— ITN 开启时 `fifty-six` 变成 `56`。需要原词就加 `--no-itn`。
5. **整段读入内存。** 适合几分钟的音频，不是为小时级录音设计的。
6. **未接入说话人分离与标点恢复** —— sherpa-onnx 有对应模型
   （`OfflineSpeakerDiarization`、`OfflinePunctuation`），但本项目还没接。

---

## 目录结构

```
I-I-IV-V/
├─ transcribe.js               CLI 入口
├─ lib/
│  ├─ paths.js                 跨平台路径与依赖解析
│  └─ wer.js                   词/字错误率 + 差异回溯
├─ setup/
│  ├─ download-model.js        模型安装器（镜像回退 + SHA256 校验）
│  └─ download-model-modelscope.js   备用下载源
├─ tests/
│  ├─ wer.test.js              单元测试（不需要模型）
│  ├─ benchmark.js             5 语言准确度评测
│  └─ e2e-test.js              全链路测试（TTS → MP3 → 转写）
├─ docs/
│  ├─ USAGE-zh.md              实战指南
│  └─ ANSWERS-zh.md            实战案例：12 道听力题逐题推导
├─ models/                     （已 gitignore，由 npm run setup 创建）
└─ demo/                       （已 gitignore，放你自己的音频）
```

---

## 常见问题

**提示「运行环境不完整」**

```bash
npm install && npm run setup
```

**模型下载失败**

所有镜像都不通？手动下载放到 `.cache/`：

```
https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2
```

或设置代理：

```bash
export HTTPS_PROXY=http://127.0.0.1:7890
```

**`Could not find sherpa-onnx-node`**（Linux / macOS）

可能需要导出原生库路径：

```bash
export LD_LIBRARY_PATH=$(pwd)/node_modules/sherpa-onnx-linux-x64:$LD_LIBRARY_PATH   # Linux
export DYLD_LIBRARY_PATH=$(pwd)/node_modules/sherpa-onnx-darwin-arm64:$DYLD_LIBRARY_PATH  # macOS
```

**找不到 ffmpeg**

```bash
npm install                          # 重装 @ffmpeg-installer
export FFMPEG_PATH=/usr/bin/ffmpeg   # 或指向系统 ffmpeg
```

---

## 参与贡献

欢迎提 Issue 和 PR，见 [CONTRIBUTING.md](CONTRIBUTING.md)。
目前最有价值的三个方向：**说话人分离**、**标点恢复**、**长音频 VAD 分块**。

---

## 许可

代码用 [MIT](LICENSE)。

运行时下载但不随仓库分发：sherpa-onnx（Apache-2.0）、
SenseVoice 模型权重（Apache-2.0）、FFmpeg（LGPL/GPL）。
完整第三方声明见 [LICENSE](LICENSE)。
