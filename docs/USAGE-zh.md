# 实战指南：用 asr-local 做听力作业
**这是一坨石山，慎用*

工具本身怎么用见 [README.zh-CN.md](../README.zh-CN.md)；这份文件只讲**流程**。

---

## 一句话流程

**拿到音频 → 转写 → 逐题回原文找唯一性证据 → 填答案。**

---

## 第一步：拿到音频

### 情况 A：已有音频文件（最省事）

```bash
node transcribe.js --lang en "路径/音频.mp3"
```

### 情况 B：音频还在在线作业平台上

很多教育平台的音频 CDN 是**公开可读的，不需要登录**。做法：

1. 打开作业页面，按 `F12` → **Network** 面板
2. 筛选框输入 `mp3`（或 `audio`）
3. 把音频 URL 复制下来

拿到 URL 就能直接下载：

```bash
curl -o audio.mp3 "https://example.com/path/to/audio.mp3"
node transcribe.js audio.mp3
```

> URL 里通常有平台内部编号（如 `p_10108139` 这种"试卷号"），
> **同一份作业的音频一般都在同一个目录下**，可以据此批量下载。

### 情况 C：怀疑音频被分段切碎了

有的平台会把一段长听力切成多个小文件。判断方法：

| 文件特征 | 大概率是 |
|---|---|
| 40–130 秒，文件较大 | **正文**（对话/段落），要转写的就是它 |
| 1–5 秒，文件很小 | **念出来的题干**（"What does the woman say about…?"） |

**小文件往往是题干朗读**——这等于白送你一份官方题干，可以用来校验"音频 ↔ 题号"的对应关系。

---

## 第二步：转写

```bash
# 英语听力（最常见）
node transcribe.js --lang en 目录/

# 不确定语言
node transcribe.js --lang auto 目录/

# 需要保留数字原词
node transcribe.js --no-itn 音频.mp3
```

**建议把整组的正文音频放一个目录里一次转完**，方便横向对照。

---

## 第三步：逐题核对（这一节最重要）

### ⚠️ 转写出错的重灾区

1. **中文人名拼音最不可靠。**
   实测「华罗庚」被转成 `Xin Jing run` / `Chun Jing run` / `Qin Jing run` 三种拼法。
   **看到不像英文名字的怪词，按发音回推中文人名。**

2. **不分说话人，句间没有标点。**
   长对话里两个人的话会粘在一起。例如：

   ```
   ...keep me relaxed yet engaged interesting I tend to go for non-fiction...
   ```

   其中的 `interesting` 其实是**另一个人**说的。**这是最容易导致选错的地方。**

3. **专有名词拼写**：`travelogues`→`Travellos`、`nerve-racking`→`nerveacking`

### 强制自查清单（每题都过一遍）

| # | 检查项 |
|:---:|---|
| 1 | **题干问的是谁？**（the woman / the man / the boy / both） |
| 2 | **我引用的那句话，说话人是谁？** 转写不标说话人，最容易张冠李戴 |
| 3 | **其他三个选项错在哪？** 说不出错因的选项，多半是我理解错了 |
| 4 | **有没有"措辞陷阱"？** 出题人爱用原文里的**真词**造**假选项** |
| 5 | **有没有"反向陷阱"？** 选项把原文说反（如把 `poor family` 改成 `financial stability`） |

---

## 真实案例：12 道听力题，第一轮只对 55%

这不是编的，是这套工具第一次实战的记录。

### 第一轮错 5 题，全是同一个毛病

**只匹配关键词，不追踪"这句话是谁在什么语境下说的"。**

| 题 | 错误症状 | 正解 |
|:---:|---|---|
| 1 | 看到选项含 `interesting` 就去原文搜，搜到男人敷衍的那句，信了 | 题干问的是**女人**！`interesting` 是男人说的 |
| 2 | 看到 `escape` 就选，没注意那是**女人**说她自己的状态 | 男人说的是 `learning... feels oddly satisfying` |
| 3 | —— | 正确 |
| 4 | —— | 正确 |
| 5 | 看到 `talk to his teacher` 就选，没注意那是**妈妈**的提议 | 男孩的困扰是 `too hard for me` |
| 9 | 看到 `personal details` 联想到警察问的 `contact information` | 那只是**报案登记流程**，不是"资料被泄露" |

### 修订过程

| 轮次 | 得分 | 改动 |
|:---:|:---:|---|
| 第 1 轮 | **55%** | 初版答案 |
| 第 2 轮 | **60%** | 改 3 题（2、5、9），只净赚 1 题 |
| 第 3 轮 | **100%** | 放弃"感觉对"，改为逐题找**唯一性锚点** + 强制回答"其余选项错在哪" |

### 关键转折

1. **发现"短音频 = 念出来的题干"** —— 拿到官方题干后，才确认音频与题组的对应没错，问题出在判断上
2. **外部反馈（55% → 60%）逼着放弃自证** —— 只看第一轮，我会以为自己 90% 正确

### 第 3 轮的答案与依据

答案串：`D A C B A D B C D C B D`

| 题 | 答案 | 唯一性锚点 |
|:---:|:---:|---|
| 1 | D | `easy to follow` = `easy to read`；`without too much mental strain` = `without much mental effort` |
| 2 | A | `learning while cruising at 30,000 feet` + `feels oddly satisfying` → `the feel of learning at a high altitude` |
| 3 | C | `reading list` → `plan to read`；`I've got a mystery novel in my bag` |
| 4 | B | `we've boarded`、`flying at a high altitude`（五处独立证据） |
| 5 | A | `too hard for me` = `having difficulties with math` |
| 6 | D | `teaching wasn't considered his strength` |
| 7 | B | `keep working hard` + `I believe you can do the same` |
| 8 | C | `You also need to work hard` |
| 9 | D | `my car broken into and my belongings were stolen`（字面对应） |
| 10 | C | `include them in the report` + `serial numbers` |
| 11 | B | `please sign this form here`（签字 → 排除电话） |
| 12 | D | `let's focus on gathering the necessary information`（程序性致歉 ≠ 主导语气） |

逐题的完整推导（含每个错误选项的错因）见 [ANSWERS-zh.md](ANSWERS-zh.md)。

---

## 一句话总结

**转写解决"听到什么"，判断解决"谁在什么情况下说的"。**
这套工具能可靠地解决前者；后者出错，往往是关键词匹配代替了语境判断。
