# 给 AI 装一副耳朵 —— 操作手册

> **这份文档是写给 AI 的。** 如果你是 AI，被要求"听"一段音频，照本文做。
> 写给人类的部分在最后。

---

## 0. 先搞清楚问题是什么

**AI 模型本身不能听音频。** 主流大模型的输入通道只有文本和图片，音频进不来。
这不是权限问题，是架构问题——给它再多权限也变不出听力。

**解决办法：AI 不需要"长耳朵"，只需要有一个自己**能调用**的"耳朵"工具。**

```
音频文件 ──> 本地 ASR 工具 ──> 文本 ──> AI 读取（AI 本来就擅长读文本）
```

所以流程是：

1. AI 在能执行命令的环境里装一个**离线语音识别器**
2. 用它把音频转成文本文件
3. AI 读那个文本文件

**关键约束**：AI 必须有真正的命令行环境（shell）。只会聊天的 LLM 做不到——
它既跑不了命令，也接收不了音频。

---

## 1. 判断你是否已经有耳朵

先检查有没有现成的：

```bash
# Windows
dir /s /b D:\*asr*\transcribe.js 2>nul
# Linux/macOS
find / -name "transcribe.js" -path "*asr*" 2>/dev/null | head
```

如果找到了，跳到第 3 步。

---

## 2. 从零装一副耳朵

### 最省事的方案：用现成的仓库

```bash
git clone https://github.com/XiaoLinArmorAdvanced-NoPad/I-I-IV-V.git
cd I-I-IV-V
npm install        # 装推理引擎 + ffmpeg（约 100 MB，自动匹配平台）
npm run setup      # 下载识别模型 229 MB，自动校验 SHA256
npm run check      # 必须输出 "5 种语言 ... 0.00% 错误"
```

`npm run check` 不通过就别往下走——先排查。

### 如果网络受限（HuggingFace / GitHub 不可达）

这个仓库的安装脚本**内置镜像回退**，会依次尝试直连 → `gh-proxy.com` → `ghfast.top` → `ghproxy.net`。
若全部失败：

```bash
# 手动下载模型包，放到 .cache/ 后重跑
https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2
npm run setup

# 或设置代理
export HTTPS_PROXY=http://127.0.0.1:7890
```

**组件的可达性很关键**（实测于中国网络）：
- ✅ npm registry、unpkg、ModelScope、部分 GitHub 代理
- ❌ HuggingFace、GitHub 主站、jsDelivr

模型官方地址在 HuggingFace 上——**拿不到**。所以必须走 GitHub 代理。
另外 `ffmpeg-static` 会因为要从 GitHub 下载二进制而失败，用 `@ffmpeg-installer/win32-x64` 替代（二进制在 npm tarball 内）。

---

## 3. 用耳朵听

```bash
node transcribe.js "音频.mp3"                    # 输出到 音频.txt
node transcribe.js "音频.mp3" --lang auto         # 自动检测语言
node transcribe.js "音频.mp3" --json              # 结构化输出
node transcribe.js "整个目录"                      # 批量
```

### `--json` 是给 AI 用的重点

```json
{
  "results": [{
    "ok": true,
    "text": "识别出的文字",
    "lang": "ja",          ← 检测到的语言
    "event": "BGM",        ← 事件类型（BGM = 音乐，Speech = 说话）
    "duration": 216.7,
    "elapsed": 42.9
  }]
}
```

**`event` 字段是置信度信号**：
- `Speech` → 正常说话内容
- `BGM` → 模型判定是音乐，**转写结果不可信**
- 其它 → 参考 `event` 值判断

---

## 4. ⚠️ 用之前必须知道的坑

### 4.1 最危险：它会自信地给出错误答案

低信噪比下模型**不输出乱码，而输出合理的词**。实测：

```
真值:          ...presented him with 50 pieces of code.
信噪比 20 dB:  ...50 pieces of gold.
信噪比 10 dB:  ...50 pieces of food.
```

句子通顺、语法正确——**光读文字发现不了**。所以：

> **不要把转写当事实。** 数字、人名、金额、日期必须交叉验证。
> 向用户报告时说明"以下为机器转写，关键信息请核对原音"。

### 4.2 准确度实测（可复现）

| 条件 | 错误率 |
|---|---|
| 干净真人语音，默认参数 | **0.00%**（5 语言 94 单位逐字一致） |
| 信噪比 20 dB | 6.7% |
| 信噪比 15 dB | 20% |
| 信噪比 0 dB | 33% |
| 轻混响 | 6.7% |
| **唱歌** | 严重错乱（`event: BGM`） |
| **两人同时说话** | 只输出其中一人 |

### 4.3 其它必知

- **中文人名拼音最弱**：实测「华罗庚」被转成 `Xin Jing run` / `Chun Jing run` / `Qin Jing run` 三种拼法。
- **方言支持有限**：官方只提供 5 个语言码（en/zh/ja/ko/yue）。**粤语是唯一作为独立语言码的方言**；四川话、东北话、闽南语等没有独立支持，会被当普通话处理。
- **不分说话人、句间无标点**：长对话里两个人的话会粘在一起，是误读的主要来源。
- **`--lang` 只是提示**：实测用错误语言码识别英语仍 0% 错误，模型内部会自行判断语言。不确定时用 `auto`。
- **ITN 影响数字写法**：默认 `9`，`--no-itn` 则输出 `九`。与官方参考文本比对时用默认。

### 4.4 资源

| 音频长度 | 耗时 | 峰值内存 |
|---:|---:|---:|
| 60 s | 2.2 s | 519 MB |
| 300 s | 25 s | **1.7 GB** |
| 600 s | 94 s | **5.4 GB** |

**整段音频会读进内存，内存随长度超线性增长。**
> 处理超过 2 分钟的音频前，**先用 ffmpeg 切片**，否则可能 OOM：

```bash
ffmpeg -i long.mp3 -f segment -segment_time 120 -c copy part_%03d.mp3
for f in part_*.mp3; do node transcribe.js "$f"; done
cat part_*.txt > full.txt
```

---

## 5. 什么情况下应当拒绝或警告用户

| 输入 | 应当怎么做 |
|---|---|
| 歌曲 / 音乐 | 告知不是语音识别场景；检查 `event == BGM` 并说明结果不可靠 |
| 多人会议 | 告知无法分离说话人，只会输出混合文本 |
| 嘈杂录音 | 告知低信噪比下错误会伪装成合理句子 |
| 方言 / 重口音 | 告知支持有限，需人工校对 |
| 需要逐字稿 | 建议 `--no-itn`，并说明数字会变成汉字/单词写法 |
| 超过 2 分钟的音频 | 先切片再转写 |

---

## 6. 验证是否装好（一条命令）

```bash
npm run verify        # 语法 + 全部测试 + 准确度画像，约 95 秒
```

期望输出：

```
汇总: 8 / 8 项关键检查通过
✅ 全部通过 —— 这个版本可以放心使用和发布
```

---

## 7. 备选方案（如果 CLI 路线走不通）

### 7.1 浏览器端：AI 通过网页工具取数据

如果 AI 无法执行命令，但能读文件，可以让人类用浏览器生成数据：

1. 在目标页面跑采集脚本，把 DOM / 网络请求 / 存储导出成 JSON
2. AI 读那个 JSON

（本项目的 `analyze.js` 走的就是这条路，用于从在线平台提取音频 URL。）

### 7.2 实时字幕：人类侧生成文本

Windows 按 `Win`+`Ctrl`+`L` 开实时字幕，播放音频，字幕转文字后交给 AI。
**纯离线、免费、不需要装东西**，适合一次性应急。

### 7.3 whisper.cpp / 其它模型

公开网络环境下的替代方案（本机因 HuggingFace 不可达没走通）：

```bash
# 需要能访问 HuggingFace 或 GitHub
git clone https://github.com/ggerganov/whisper.cpp
# 下载 ggml 模型后 ./main -m models/ggml-base.en.bin -f audio.wav
```

---

## 8. 给人类看的部分

**你想让 AI 帮你听音频，怎么做：**

1. 确保 AI 有命令行环境（Claude Code / Cursor / Codex CLI / DSH 这类）
2. 把音频文件给它，或告诉它文件路径
3. 或者把本仓库链接给它，说「克隆这个仓库、装好、然后转写我的音频」

**不要**把音频发给只会聊天的网页版 AI——它收不到，也跑不了命令。

**如果 AI 说"我听不了"**：那是它没装工具，不是做不到。把这份文档给它。
