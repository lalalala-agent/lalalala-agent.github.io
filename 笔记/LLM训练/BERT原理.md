## 一、BERT 整体结构

BERT 是基于 Transformer Encoder 的预训练语言模型，核心作用是根据上下文为每个 Token 生成上下文相关的向量表示。

输入 `I love machine learning` 经分词：

```text
[CLS] i love machine learning [SEP]
```

整体流程：

```text
输入文本 → Tokenizer → Input IDs + Attention Mask + Token Type IDs
→ Embedding 层（Token + Position + Token Type）
→ LayerNorm + Dropout
→ Transformer Encoder × 12
→ last_hidden_state
   ├── 全部 Token 向量
   └── [CLS] 向量 → Linear → tanh → pooler_output
```

BERT Base 关键参数：Hidden Size 768，12 层，12 个注意力头（每头 64 维）。

---

## 二、输入与 Embedding 层

### 2.1 Tokenizer

文本先转为 Token，再映射为 Token ID：

```python
input_ids = [101, 1045, 2293, 3698, 4083, 102]
```

| Token | 作用 |
|---|---|
| `[CLS]` | 序列开头，常用于分类 |
| `[SEP]` | 句子边界 |
| `[PAD]` | 长度补齐 |
| `[MASK]` | MLM 预训练中使用 |

Token ID 只是词表索引，本身不含语义，向量来自 Embedding 参数。

### 2.2 Embedding 层

经典 BERT 的输入 Embedding 由三部分相加：

$$
E_i = E_{\text{token},i} + E_{\text{position},i} + E_{\text{segment},i}
$$

- **Token Embedding**：Token 的初始向量。
- **Position Embedding**：Token 在序列中的位置（可学习）。
- **Token Type Embedding**：区分句子片段，单句任务全为 0。

三者相加后经 LayerNorm 和 Dropout，送入第一层 Encoder。输出形状 `[batch_size, sequence_length, hidden_size]`，如 `[2, 10, 768]`。768 是每个 Token 的向量维度，不是句子维度。

---

## 三、Transformer Encoder

BERT Base 含 12 个 Encoder Block，每个 Block 输入输出形状均为 `[B, L, 768]`，包含两个子层：

1. Multi-Head Self-Attention
2. Feed-Forward Network

均带残差连接和 LayerNorm。

### 3.1 Multi-Head Self-Attention

作用：让每个 Token 根据上下文其他 Token 更新自身表示。

**第一步：计算 Q、K、V**

$$
Q=XW_Q,\quad K=XW_K,\quad V=XW_V
$$

- Query：当前 Token 想获取什么信息
- Key：每个 Token 提供什么特征供匹配
- Value：匹配后实际聚合的信息

**第二步：注意力计算**

$$
Attention(Q,K,V)=softmax\left(\frac{QK^T}{\sqrt{d_k}}\right)V
$$

**第三步：多头**

12 个头各自独立计算（每头 64 维），拼接后线性映射回 768 维。不同头学习不同关联模式，但不能简单认定某头只负责语法或语义。

### 3.2 残差连接与 LayerNorm

$$
H_1=LayerNorm(X+Attention(X))
$$

残差保留输入信息，LayerNorm 稳定训练。

### 3.3 Feed-Forward Network

$$
FFN(x)=GELU(xW_1+b_1)W_2+b_2
$$

中间维度 3072：`768 → 3072 → GELU → 768`。FFN 对每个位置独立计算，Token 间信息交互主要发生在注意力层。

一个 Encoder Block：

```text
输入 X → Multi-Head Self-Attention → 残差 + LayerNorm
→ FFN → 残差 + LayerNorm → 输出 H
```

### 3.4 为什么堆叠 12 层

每层对 Token 表示进一步变换，逐层融合上下文。不能简单认为浅层只学词法、深层只学语义，各层特征会交叠。

**关键：每一层都输出所有 Token 的向量，而不只是 `[CLS]`。**

---

## 四、两种输出：last_hidden_state 与 pooler_output

### 4.1 last_hidden_state

最后一层 Transformer 输出：

$$
H^{(12)}\in\mathbb{R}^{B\times L\times 768}
$$

对应 `outputs.last_hidden_state`，形状 `[batch_size, sequence_length, hidden_size]`。

每个位置对应一个 Token 的 768 维向量。经过多层双向自注意力后，每个位置的向量都包含整个有效输入序列的上下文信息。

提取 `[CLS]` 向量：

```python
cls_hidden_state = outputs.last_hidden_state[:, 0, :]  # [B, 768]
```

这一步只是取出第一个位置的向量，**没有额外线性变换或激活**。

### 4.2 pooler_output

**结论：`pooler_output` 是最后一层 `[CLS]` 隐藏向量经过可学习线性层和 `tanh` 激活后的结果。** 它不是所有 Token 的平均，也不是直接从原始文本计算的句子向量。

取出 `[CLS]` 向量：

$$
h_{\mathrm{CLS}}=H[:,0,:]\in\mathbb{R}^{B\times768}
$$

线性变换（\(W\) 为 \(768\times768\)，\(b\) 为 768 维，通过训练重新组合特征）：

$$
z=h_{\mathrm{CLS}}W^T+b
$$

`tanh` 激活：

$$
\boxed{\text{pooler\_output}=\tanh(h_{\mathrm{CLS}}W^T+b)}
$$

`tanh` 将数值映射到 \((-1,1)\)：

| 输入 | tanh 输出（约） |
|---:|---:|
| -2 | -0.964 |
| -1 | -0.762 |
| 0 | 0 |
| 1 | 0.762 |
| 2 | 0.964 |

最终 `pooler_output` 形状 `[B, 768]`：

```text
last_hidden_state [B, L, 768]
→ 取第 0 个 Token [B, 768]
→ Linear(768, 768)
→ tanh
→ pooler_output [B, 768]
```

### 4.3 代码验证

```python
import torch
from transformers import AutoTokenizer, AutoModel

model_name = "google-bert/bert-base-uncased"
tokenizer = AutoTokenizer.from_pretrained(model_name)
model = AutoModel.from_pretrained(model_name)

inputs = tokenizer("I love machine learning", return_tensors="pt")

with torch.no_grad():
    outputs = model(**inputs)

print(outputs.last_hidden_state.shape)  # [1, 6, 768]
print(outputs.pooler_output.shape)      # [1, 768]

with torch.no_grad():
    cls_hidden_state = outputs.last_hidden_state[:, 0, :]
    manual = torch.tanh(model.pooler.dense(cls_hidden_state))

print(torch.allclose(manual, outputs.pooler_output))  # True
```

若模型无 Pooler 或经过修改，`model.pooler` 可能不存在，`pooler_output` 可能为 `None`。

### 4.4 两者对比

以 `[CLS] I love AI [SEP]`、Batch Size 1 为例：

| 比较维度 | last_hidden_state | pooler_output |
|---|---|---|
| 来源 | 最后一层 Encoder | 最后一层 `[CLS]` 经 Pooler |
| 形状 | `[1, 5, 768]` | `[1, 768]` |
| 包含所有 Token | 是 | 否 |
| 额外线性层 | 否 | 是 |
| 额外 tanh | 否 | 是 |
| 保留 Token 维度 | 是 | 否 |
| 常见用途 | Token 分类、序列标注 | 句子级分类特征 |

关键区别：

```python
outputs.last_hidden_state[:, 0, :]   # 直接取 [CLS] 隐藏状态
outputs.pooler_output                # 再经 Linear + tanh
```

两者维度相同，数值通常不同。关系为：

$$
\underbrace{H[:,0,:]}_{\text{CLS 隐藏状态}}
\xrightarrow{\text{Linear}}
\xrightarrow{\tanh}
\underbrace{\text{pooler\_output}}_{\text{池化器输出}}
$$

注意：Pooler 名称容易误导，标准 BERT 中它只处理第一个 Token，并不对所有 Token 做池化。

### 4.5 hidden_states（补充）

启用方式：

```python
outputs = model(**inputs, output_hidden_states=True)
print(len(outputs.hidden_states))  # 13
```

12 层 BERT Base 得到 13 个隐藏状态：

```text
hidden_states[0]  ：Embedding 层输出
hidden_states[1]  ：第 1 层 Transformer 输出
...
hidden_states[12] ：第 12 层 Transformer 输出
```

`outputs.hidden_states[-1]` 通常与 `outputs.last_hidden_state` 对应相同最终状态，形状均为 `[B, L, 768]`。

| 输出 | 含义 | 典型形状 |
|---|---|---|
| `hidden_states[0]` | Embedding 层输出 | `[B, L, 768]` |
| `hidden_states[1..12]` | 各 Transformer 层输出 | `[B, L, 768]` |
| `last_hidden_state` | 最后一层 Transformer 输出 | `[B, L, 768]` |
| `pooler_output` | `[CLS]` 经 Linear + tanh | `[B, 768]` |

---

## 五、为什么 BERT 需要 Pooler

原始 BERT 预训练任务：

1. **MLM**：预测被遮住的 Token，需要 Token 级表示，对应 `last_hidden_state`。
2. **NSP**：判断两段文本是否连续，使用 `[CLS]` 表示经 Pooler 变换后接分类器。

```text
句子 A + 句子 B → BERT → 最后一层 [CLS] 向量
→ Linear + tanh → pooler_output → NSP 分类器 → 是否为下一句
```

Pooler 权重在预训练期间通过 NSP 目标训练，并非随机变换。但**为 NSP 学到的表示不等于对所有下游语义任务都最优的句子表示**，不能因形状是 `[B, H]` 就认定它是最好的句向量。

---

## 六、实际项目中的选择

### 场景一：文本分类

情感分类、新闻分类、垃圾文本识别、意图识别等，常用 `[CLS]` 表示接分类头：

```python
import torch.nn as nn
from transformers import AutoModel

class BertClassifier(nn.Module):
    def __init__(self, model_name, num_labels):
        super().__init__()
        self.bert = AutoModel.from_pretrained(model_name)
        self.classifier = nn.Linear(self.bert.config.hidden_size, num_labels)

    def forward(self, input_ids, attention_mask):
        outputs = self.bert(input_ids=input_ids, attention_mask=attention_mask)
        cls_vector = outputs.last_hidden_state[:, 0, :]
        return self.classifier(cls_vector)
```

也可把 `cls_vector` 换成 `outputs.pooler_output`，两种方式都可行，**哪种更好需通过具体任务训练验证**。若使用 `BertForSequenceClassification`，注意它有自己的任务头，不能把其输出等同于 `pooler_output`。

### 场景二：文本相似度、语义搜索

简单方案是取 `[CLS]` 向量，或使用 Mean Pooling。

Mean Pooling 公式（\(M_i\) 为 Attention Mask，有效 Token 为 1）：

$$
h_{\text{mean}}=\frac{\sum_{i=1}^{L}M_iH_i}{\sum_{i=1}^{L}M_i}
$$

```python
import torch.nn.functional as F

token_embeddings = outputs.last_hidden_state
mask = inputs["attention_mask"].unsqueeze(-1).to(token_embeddings.dtype)

sum_embeddings = (token_embeddings * mask).sum(dim=1)
sum_mask = mask.sum(dim=1).clamp(min=1e-9)
mean_embeddings = sum_embeddings / sum_mask

sentence_embeddings = F.normalize(mean_embeddings, p=2, dim=1)  # [B, 768]
```

**普通 BERT 的 `pooler_output` 不一定适合语义搜索或句子相似度**，因为 Pooler 并非为让语义相近句子在向量空间靠近而训练。若目标是句子相似度、向量检索或 RAG 召回，建议优先考虑经过对比学习训练的句向量模型（如 Sentence Transformers），而不是假设普通 BERT 的 Pooler 最优。

### 场景三：命名实体识别、序列标注

需要预测每个 Token 的标签，直接使用 `last_hidden_state`：

```python
token_classifier = nn.Linear(768, num_labels)
token_logits = token_classifier(outputs.last_hidden_state)
# [batch_size, sequence_length, num_labels]
```

此处不适合 `pooler_output`，因为它已不含独立 Token 维度。

---

## 总结

```text
输入文本 → Tokenizer → Input IDs → Embedding
→ Transformer 第 1 层 → ... → Transformer 第 12 层
→ last_hidden_state [B, L, 768]
   ├── 所有 Token → Token 级特征 [B, L, 768] → NER、序列标注等
   └── 第 0 个 Token [CLS] [B, 768]
        → Linear(768, 768) → tanh → pooler_output [B, 768] → 分类等下游任务
```

**记住这 4 点：**

1. **`last_hidden_state`**：最后一层全部 Token 向量，形状 `[B, L, H]`。
2. **`last_hidden_state[:, 0, :]`**：`[CLS]` 隐藏状态，形状 `[B, H]`。
3. **`pooler_output`**：`[CLS]` 隐藏状态经可学习 Linear + tanh，形状 `[B, H]`。
4. **`pooler_output` 不等于最优句向量**：语义搜索/句子相似度应考虑 Mean Pooling 或专门训练的句向量模型。

BERT Base 隐藏维度 \(H=768\)，BERT Large 为 1024。模型是否提供 Pooler 取决于实现和配置。

---