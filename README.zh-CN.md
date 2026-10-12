# asr-local

**完全离线的音频转写。不需要登录、不需要 API Key、不联网。**
**本代码由蓝色大肥鱼DeepSeek鼎力支持**
**README其实大部分也是DS写的**
**不会装那就把链接或者文件直接甩给AI就行了**

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

## 🤖 给 AI 的说明

**本仓库不含模型。** 模型有 229 MB，由 `setup/download-model.js` 在首次运行时下载。
在它完成之前，这个程序**没有任何转写能力**。

如果你是 AI 助手，被要求装好它并转写音频，照抄执行：

```bash
git clone https://github.com/XiaoLinArmorAdvanced-NoPad/I-I-IV-V.git
cd I-I-IV-V
npm install        # 装原生引擎 + ffmpeg，约 100 MB，自动匹配平台
npm run setup      # 下载 229 MB 模型，并校验 SHA256
npm run check      # 必须输出 "5 种语言 ... 0.00% 错误"；若不是，停下来排查
node transcribe.js "/绝对路径/音频.mp3"
```

然后读取音频旁的 `.txt`（或加 `--json` 拿结构化输出）。

给 AI 的注意事项：

- `npm run setup` 先试直连 GitHub，失败会依次尝试镜像——**受限网络下也能装上**。
- 转写结果写在 `<音频名>.txt`；多个文件时额外汇总到 `transcripts-all.txt`。
- **输入必须是说话，不是唱歌。** 歌声转写质量很差；模型检测到音乐时会在 `--json` 输出里给出 `event: BGM`，看到它就应当视为低置信度。
- 非英语音频加 `--lang <zh|ja|ko|yue|auto>`，默认是 `en`。

**不要把仓库链接甩给只会聊天的 LLM 并指望它转写**——它没有命令行环境，也接收不了音频。
只有带真实 shell 的编程 Agent 才做得到。

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
5. **长音频自动分块（按 VAD 找自然停顿）。** 超过 300 秒会分块，内存可控
   （600 秒：5.4 GB → 1.6 GB，且快 3 倍）。**固定时间切块试过，会丢内容**——它从词中间切断。
6. **未接入说话人分离与标点恢复** —— sherpa-onnx 有对应模型
   （`OfflineSpeakerDiarization`、`OfflinePunctuation`），但本项目还没接。
   （所以这些全部需要你们自己搞UwU）

### 什么时候会不准 —— 实测数据，不是估计

完整数据与复现命令见 **[docs/ACCURACY-zh.md](docs/ACCURACY-zh.md)**

| 条件 | 错误率 | 结论 |
|---|:---:|---|
| 干净真人语音，默认参数 | **0.00%** | 5 语言 94 单位，逐字一致 |
| 信噪比 ≈ 20 dB | 6.7% | 开始退化 |
| 信噪比 ≈ 15 dB | 20% | 不可靠 |
| 信噪比 ≈ 0 dB | 33% | 基本不可用 |
| 轻混响 | 6.7% | 可接受 |
| **两人同时说话** | — | **只输出其中一人的话** |
| **唱歌** | — | **严重错乱**；`--json` 会给出 `event: BGM` |
| 粤语以外的中文方言 | — | **无独立语言码，会被当普通话处理** |

**最危险的失败模式**：低信噪比下模型不会输出乱码，而是输出**听起来合理的词**。
`50 pieces of code` 会变成 `50 pieces of gold`，再变成 `50 pieces of food`。
错误句子通顺、语法正确，**光读文字极难发现**。

> **适合给 AI 使用，但必须遵守**：不要把转写结果当事实。数字、人名、金额、日期
> 必须交叉验证；输入是音乐、多人、重口音或嘈杂环境时，应主动告知用户结果需人工校对。

### 关于「给 AI 用」

这个工具特别适合**让 AI Agent 调用**，因为：

- **完全离线** —— AI 不需要帮你申请 API Key、不用处理密钥泄露
- **一条命令出结果** —— `node transcribe.js "音频"`，AI 容易可靠地调用
- **`--json` 可程序化解析** —— 带 `lang` / `emotion` / `event` 字段，AI 能据此判断置信度
- **确定性输出** —— 同一输入 8 次结果完全一致，AI 重跑不会得到不同答案
- **失败时明确报错** —— 缺文件退出码 1、非法语言码退出码 2，AI 能可靠判断成败

**但要提醒 AI 的是**：它的"听力"来自这个模型，而模型会**自信地给出错误答案**。
所以涉及关键信息时，让 AI 回报原文并标注不确定处，而不是只给结论。

---

## 目录结构

```
I-I-IV-V/
├─ transcribe.js               CLI 入口
├─ lib/
│  ├─ paths.js                 跨平台路径与依赖解析
│  ├─ wer.js                   词/字错误率 + 差异回溯
│  └─ vad.js                   长音频按 VAD 自然停顿分块
├─ setup/
│  ├─ download-model.js        模型安装器（镜像回退 + SHA256 校验）
│  └─ download-model-modelscope.js   备用下载源
│  ├─ vad.test.js               VAD chunking correctness
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
