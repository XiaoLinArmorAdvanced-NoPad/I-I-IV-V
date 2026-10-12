# 参与贡献

感谢有兴趣改进这个项目。

## 开发环境

```bash
git clone https://github.com/XiaoLinArmorAdvanced-NoPad/I-I-IV-V.git
cd I-I-IV-V
npm install
npm run setup        # 下载模型（约 155 MB）
```

模型和 `node_modules` 都已在 `.gitignore` 中，**不会、也不要提交**。

## 提交前请自测

```bash
node tests/wer.test.js      # 单元测试，秒级，不需要模型
npm run check               # 环境 + 5 语言准确度 + 端到端
npm test                    # benchmark + e2e 全跑
```

CI（`.github/workflows/ci.yml`）会在 Ubuntu / Windows / macOS × Node 18/20/22 上跑同一套检查。
**提交前请确认本地至少 `node tests/wer.test.js` 和 `npm run check` 是通过的。**

## 代码约定

- **ESM**（`"type": "module"`），不要引入 CommonJS 写法（`lib/paths.js` 里的 `createRequire` 是刻意的例外，用于解析 npm 包路径）
- **不硬编码平台**。所有平台相关的东西走 `lib/paths.js` 或 npm 的 `optionalDependencies`
- **不加运行时网络依赖**。推理必须离线可用；只有 `setup/` 下的安装脚本允许联网
- **注释写"为什么"，不写"是什么"**。特别是踩过的坑，把原因留下来

### 一个真实的教训，请引以为戒

`lib/wer.js` 里的动态规划表**必须逐行新建数组**：

```js
// ✅ 正确
const dp = [];
for (let i = 0; i <= m; i++) { dp.push(new Array(n + 1).fill(0)); dp[i][0] = i; }

// ❌ 错误：箭头函数只接到第二个参数，i 永远是 undefined，每行都是空数组
const dp = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => ...));
```

这个 bug 真实发生过：距离算出来是荒谬值，**把 21% 的词错误率读成了 94%**，
差点据此推翻一组本来正确的答案。

`tests/wer.test.js` 里有专门的回归用例锁死它。**改 `wer.js` 请务必让那组用例通过。**

## 关于测试数据的版权

`demo/` 目录**故意留空**。早期版本里放的是某在线教育平台的听力作业音频，
那是第三方版权内容（教材配套题库），不适合随开源仓库分发。

如果要提交测试音频：

- 用**自己录制**的音频
- 用**明确开源**的语料（如 LibriSpeech、Common Voice）
- 或用系统 TTS 生成（`tests/e2e-test.js` 就是这么做的）

**不要**提交任何教材、考试、付费平台的音频或其转写文本。

## 欢迎的方向

按价值排序：

1. **说话人分离** —— sherpa-onnx 有 `OfflineSpeakerDiarization`，需接入并配模型下载
2. **标点恢复 / 分句** —— sherpa-onnx 有 `OfflinePunctuation`
3. **长音频分块** —— 目前整段读入内存，小时级录音需要 VAD 切分
4. **流式识别** —— 目前只有离线识别，实时场景需要 `OnlineRecognizer`
5. **更多语言的模型预设** —— 目前固定 SenseVoice 一个模型，可以支持切换 Whisper / Paraformer

## 提交 PR

1. Fork 并从 `main` 开分支
2. 保持改动聚焦，一个 PR 解决一件事
3. 说明**动机**和**验证方式**（跑了什么命令、结果如何）
4. 涉及行为变更的，同步更新 `README.md` 和 `README.zh-CN.md`
