# 新手入门（Windows）

完全没接触过命令行也能做完。**照顺序复制粘贴即可。**

---

## 这个工具能干什么

把**音频文件**变成**文字**：

```
讲座.mp3  →  "今天我们要讲的是……"
会议录音.m4a  →  "第一个议题是……"
英语听力.mp3  →  "The tribal chieftain called for the boy..."
```

**关键特点**：下载完模型后**全程在你电脑上算**，音频不上传、不联网、不需要账号、不花钱。

---

## 开始之前：确认你装了 Node.js

1. 按 `Win + R`，输入 `cmd`，回车（会弹出一个黑色窗口）
2. 输入这行，然后回车：

   ```
   node --version
   ```

3. **看到类似 `v20.11.0` 的字样** → 已安装，跳到下一步
   **看到"不是内部或外部命令"** → 去 <https://nodejs.org/> 下载 **LTS 版本**，双击安装（一路点"下一步"），装完**关掉黑窗口重新开一个**

---

## 第 1 步：下载这个项目

在黑色窗口里依次输入（每行回车一次）：

```
cd %USERPROFILE%\Desktop
git clone https://github.com/XiaoLinArmorAdvanced-NoPad/I-I-IV-V.git
cd I-I-IV-V
```

> 没装 git？去 <https://git-scm.com/download/win> 下载安装（一路默认）。
> 或者在本仓库页面点绿色的 **Code → Download ZIP**，解压到桌面，然后
> `cd %USERPROFILE%\Desktop\I-I-IV-V-main`

---

## 第 2 步：安装（一次性，约 5 分钟）

```
npm install
```

会下载推理引擎和 ffmpeg（约 100 MB）。看到 `added N packages` 就是成功了。

```
npm run setup
```

会下载识别模型（约 155 MB，有进度条）。看到 `✅ 安装完成` 即可。

> **下载慢或失败？** 这是国内网络的常见情况。脚本会自动尝试多个镜像。
> 如果全失败，参考 [README 的故障排查](../README.md#troubleshooting) 手动下载。

---

## 第 3 步：验证装好了

```
npm run check
```

**看到这个就成功了：**

```
[2] 五语言准确度（对照模型自带官方参考文本）
    EN  0.0% 错误  ✅ 逐字一致
    ZH  0.0% 错误  ✅ 逐字一致
    ...
    5 种语言，94 单位，错误率 0.00%  ✅ 全部通过
```

这一步用的是模型自带的**真人录音**做测试，不需要你准备任何素材。

---

## 第 4 步：转写你的第一个音频

把音频文件（mp3 / m4a / wav 都行）复制到 `asr-local` 文件夹里，比如 `D:\...\asr-local\我的录音.mp3`，然后：

```
node transcribe.js "我的录音.mp3"
```

**结果**：同目录下会生成 `我的录音.txt`，里面就是文字。

### 常用变体

```
node transcribe.js "录音.mp3" --lang auto     ← 自动识别语言（中/英/日/韩/粤）
node transcribe.js "整个文件夹"                ← 转写文件夹里所有音频
node transcribe.js "录音.mp3" --no-itn        ← 保留 "fifty-six" 而不变成 "56"
node transcribe.js "录音.mp3" --json          ← 输出 JSON 格式
```

> **路径有空格或中文？** 用英文双引号包起来，像上面那样。

---

## 常见问题

**`node` 不是内部或外部命令**
Node.js 没装好，或装完没重开窗口。见开头"开始之前"。

**`npm install` 卡住 / 报网络错误**
国内网络问题。可以换淘宝镜像加速：

```
npm config set registry https://registry.npmmirror.com
npm install
```

**`npm run setup` 下载失败**
脚本会自动轮换镜像。全失败的话，手动下载这个文件：

```
https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2024-07-17.tar.bz2
```

放到 `asr-local\.cache\` 目录下，再执行一次 `npm run setup`。

**提示 `运行环境不完整`**
八成是漏了第 2 步。按提示里的"修复"命令执行即可。

**转写结果里人名拼音很奇怪**
这是模型的已知弱点（中文人名拼音最不可靠）。看到不像英文名字的怪词，
按发音回推中文人名——例如 `Xin Jing run` 实际是「华罗庚」。

**长对话里两句话粘在一起**
模型不区分说话人、句间也不加标点。这是已知局限，
详见 [README 的 Known limitations](../README.md#known-limitations)。

---

## 玩够了想卸载

直接删掉整个 `asr-local` 文件夹即可，不写注册表、不留后台服务。

---

## 想深入

- [完整文档](../README.md) —— 全部参数、跨平台安装、API
- [实战指南](../docs/USAGE-zh.md) —— 拿它做听力题的真实案例（第一轮只对 55%，最后全对）
- [参与贡献](../CONTRIBUTING.md) —— 改代码、加功能
