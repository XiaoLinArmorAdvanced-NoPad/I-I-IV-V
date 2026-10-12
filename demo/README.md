# demo/ —— 放你自己的音频

这个目录**故意留空**，用来放你要转写的音频。

```bash
node transcribe.js demo
```

## 为什么仓库里没有示例音频

原本在这里放的是某在线教育平台的听力作业音频，但那是**第三方版权内容**（教材配套题库），
不适合随开源仓库分发，所以没有纳入版本控制（见 `.gitignore` 里的 `demo/`）。

## 想快速试一下？

**方案 A：随便找个音频**

把任意 mp3 / m4a / wav 丢进来即可。

**方案 B：用系统 TTS 生成一段英文（Windows）**

```powershell
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
$s.SetOutputToWaveFile("demo\sample.wav")
$s.Speak("The quick brown fox jumps over the lazy dog. This is a test of offline speech recognition.")
$s.Dispose()
```

然后：

```bash
node transcribe.js demo\sample.wav
```

**方案 C：用模型自带的真实录音自检**

```bash
node transcribe.js --check
```

`--check` 会直接用模型包里的 5 种语言真人录音跑一遍准确度评测，
不需要你准备任何素材——这是验证安装是否成功的最快方式。
