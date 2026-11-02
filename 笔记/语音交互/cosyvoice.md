# CosyVoice3 模型架构与部署解析

> CosyVoice3 不是一个单独的语音模型，而是一套由 **Tokenizer、LLM、Flow Matching、Vocoder、Frontend** 组成的端到端语音合成系统。结合你准备部署的 **CosyVoice3 + RTX 4090**，下面从模型结构、各模块职责、模型文件和推理流程四个方面展开说明。

---

## 一、完整模型架构

最核心的结构可以概括为：

```
输入层 Frontend
  └─ 文本归一化、文本 Tokenizer、参考音频预处理、指令处理
        │
        ▼
Speech Tokenizer（S3 Tokenizer v3）
  └─ 参考音频 → 离散语音 Token
  └─ 同时提取参考音频的声学特征和说话人信息
        │
        ▼
LLM（Qwen2.5-based）
  └─ 文本 + 指令 + 参考语音 Token → 生成 Speech Token
  └─ 可使用 vLLM 加速
        │
        ▼
Flow Matching（Causal DiT）
  └─ Speech Token → Mel Spectrogram
  └─ 结合参考 Mel 和 Speaker Embedding
  └─ Matcha-TTS 相关依赖
        │
        ▼
Vocoder（Causal HiFT）
  └─ Mel Spectrogram → Waveform
        │
        ▼
最终音频输出
  └─ 24 kHz 流式 PCM 音频
```

> ⚠️ **注意**：Speech Tokenizer 在推理中主要用于处理**参考音频**，不是每次生成目标语音时都重新编码输出音频。

---

## 二、各模块职责详解

### 1. Frontend：输入预处理

**位置**：`cosyvoice/cli/frontend.py`

主要负责：

- 文本清洗和归一化
- 文本转 Token
- 参考音频加载和重采样
- 参考音频特征提取
- 准备音色、文本和语音 Token
- 组织模型输入

**示例输入**：

```
文本：你好，欢迎使用语音合成系统。
参考音频：speaker.wav
参考文本：大家好，今天我们来介绍这个系统。
```

Frontend 将它们处理成模型可用的 Tensor。

---

### 2. Speech Tokenizer：语音编码器

**模型**：S3 Tokenizer v3

**主要功能**：将参考音频压缩为离散的 Speech Token。

它解决的问题是——**让 LLM 能够理解参考音频的语音内容和相关语音特征**。

CosyVoice3 使用监督训练的多任务语音 Tokenizer，涉及：

| 任务 | 说明 |
|------|------|
| ASR | 语音识别 |
| LID | 语言识别 |
| SER | 情感识别 |
| AED | 音频事件检测 |
| Speaker Analysis | 说话人分析 |

**推理模型文件**：`speech_tokenizer_v3.onnx`

通常将参考音频转换为 **25Hz 左右**的离散语音 Token。

> 📌 Speech Tokenizer 与文本 Tokenizer 不是同一个东西。

---

### 3. LLM：语音语言模型

> vLLM 可以优化的部分

这是 CosyVoice3 的核心生成模块，基于 **Qwen 系列架构**，CosyVoice3 0.5B 版本使用约 **0.5B 参数**规模的语言模型。

它的任务**不是直接生成 WAV**，而是：

```
输入：
  文本 Token
  指令 Token
  参考 Speech Token

输出：
  生成的 Speech Token
```

**示例流程**：

```
你好，欢迎使用 CosyVoice
        │
        ▼
  Qwen-based LLM
        │
        ▼
[120, 235, 892, 1024, ...]
```

这些数字代表**离散语音 Token**，而不是普通文字。

> 在你的部署方案中，这部分可以使用 vLLM。

---

### 4. Flow Matching：声学生成模型

> Matcha-TTS 相关技术依赖

这是 CosyVoice 非常重要的部分。

**主要实现**：

```
Speech Token
     +
Prompt Mel
     +
Speaker Embedding
     │
     ▼
Causal DiT
     │
     ▼
Mel Spectrogram
```

CosyVoice3 使用：

- Conditional Flow Matching
- Causal DiT（Diffusion Transformer 风格骨干）
- PreLookaheadLayer
- Speaker Conditioning

它负责把抽象的 Speech Token 转换成具体的声学特征。

**公开配置中的主要参数**：

| 参数 | 配置 |
|------|------|
| DiT 层数 | 22 |
| Hidden Size | 1024 |
| Attention Heads | 16 |
| Mel 维度 | 80 |
| Token 到 Mel 比例 | 1:2 |

> ⚠️ **关键点**：vLLM 只负责 LLM，**不会自动加速 Flow Matching**。因此，即使 LLM 使用了 vLLM，Flow 仍可能是单卡推理的性能瓶颈。

---

### 5. Vocoder：声码器

**模型**：Causal HiFT
**位置**：`cosyvoice/hifigan/generator.py`

**主要功能**：

```
Mel Spectrogram
       │
       ▼
Causal HiFT Generator
       │
       ▼
Waveform
```

Mel 是频谱特征，不是真正可以播放的声音。Vocoder 将 Mel 转换成真实音频波形。

CosyVoice3 使用 Causal HiFT Generator，并包含 F0 预测等声码器相关组件。

**最终输出**：

- 24kHz 音频
- 流式音频 Chunk
- PCM 波形数据

---

## 三、模型文件清单

CosyVoice3 0.5B 的模型目录通常包含以下文件（具体名称随模型版本和仓库组织方式有所差异）：

```
Fun-CosyVoice3-0.5B-2512/
│
├── llm.pt
├── flow.pt
├── hift.pt
├── speech_tokenizer_v3.onnx
├── campplus.onnx
├── spk2info.pt
├── CosyVoice-BlankEN/
└── configuration.json
```

| 文件 | 作用 |
|------|------|
| `llm.pt` | LLM 语言模型权重 |
| `flow.pt` | Flow Matching / DiT 权重 |
| `hift.pt` | Vocoder 权重 |
| `speech_tokenizer_v3.onnx` | 参考语音编码 |
| `campplus.onnx` | 说话人向量提取（192 维 Speaker Embedding） |
| `spk2info.pt` | 预置说话人信息 |
| `CosyVoice-BlankEN/` | 文本 Tokenizer 等资源 |

> 📌 以上是典型 Runtime 资源组织示意，实际下载目录应以对应 Hugging Face 模型仓库为准。

---

## 四、流式推理协作流程

> 这是与你的 **20～50 并发部署**最相关的部分。

CosyVoice3 **并不是**等 LLM 全部生成完毕，再开始 Flow 和 Vocoder。它支持**分块流水线**：

```
LLM      :  Token 1  →  Token 2  →  Token 3  →  Token 4
                │          │          │          │
Flow     :     Mel 1  →   Mel 2   →  Mel 3   →  Mel 4
                │          │          │          │
Vocoder  :   Audio 1 →  Audio 2  → Audio 3  → Audio 4
                │          │          │          │
WebSocket:  ────────────────────────────────────────►  持续返回音频 Chunk
```

> 以上表示数据依赖关系，不代表各模块严格同时执行。

**官方 Runtime 的生成线程与分块处理逻辑**：

1. LLM 开始生成 Speech Token
2. 积累到满足条件的 Token 数量
3. Flow 开始生成对应 Mel
4. Vocoder 将 Mel 转换成音频
5. 返回音频 Chunk
6. LLM 继续生成，重复上述过程

这意味着你的并发瓶颈可能分别出现在三个阶段：

- **LLM**：Token 生成速度
- **Flow**：Mel 生成速度
- **Vocoder**：音频解码速度

---

## 五、RTX 4090 GPU 资源分配

建议把模型拆成三个主要 GPU 计算模块：

| 模块 | 是否使用 GPU | 优化方向 |
|------|:---:|------|
| Speech Tokenizer | 可使用 GPU / ONNX Runtime | 控制预处理开销 |
| LLM | ✅ | vLLM、KV Cache、批处理 |
| Flow DiT | ✅ | FP16 / BF16、分块推理 |
| Vocoder | ✅ | 分块推理、优化卷积 |
| Frontend | 部分 | CPU 并行 |

> ⚠️ **重要架构问题**：vLLM 和 Flow/Vocoder 会**共享同一张 4090**。不能简单认为「LLM 用 10GB、Flow 用 10GB」就一定可以稳定共存，还需考虑 **CUDA 工作区、KV Cache、激活值和显存峰值**。

---

## 六、推荐源码阅读顺序

如果想真正理解 CosyVoice3，建议按以下顺序阅读：

| 顺序 | 源码 | 重点 |
|:---:|------|------|
| 1 | `cosyvoice/cli/cosyvoice.py` | 模型加载与入口 |
| 2 | `cosyvoice/cli/frontend.py` | 输入预处理 |
| 3 | `cosyvoice/cli/model.py` | TTS 推理调度 |
| 4 | `cosyvoice/llm/llm.py` | LLM 推理 |
| 5 | `cosyvoice/flow/flow.py` | Flow 模型 |
| 6 | `cosyvoice/flow/flow_matching.py` | Flow Matching |
| 7 | `cosyvoice/flow/DiT/dit.py` | DiT 网络 |
| 8 | `cosyvoice/hifigan/generator.py` | Vocoder |

**参考资料**：

- CosyVoice 官方 GitHub
- CosyVoice3 技术论文
- CosyVoice3 0.5B 模型文件

---

## 七、核心架构结论

对于你准备做的高并发部署，建议这样理解整个系统：

| 模块 | 部署策略 |
|------|------|
| Frontend | FastAPI 服务侧处理 |
| Speech Tokenizer | ONNX Runtime，按需 GPU / CPU |
| LLM | vLLM 或 vLLM-Omni |
| Flow Matching | CosyVoice Runtime |
| Vocoder | CosyVoice Runtime |
| 音频输出 | WebSocket |
