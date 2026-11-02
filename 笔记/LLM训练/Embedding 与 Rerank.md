# Embedding 与 Rerank：原理、训练及在 RAG 中的应用

> Embedding 和 Rerank 是现代语义检索与 RAG（Retrieval-Augmented Generation，检索增强生成）系统中的两个核心组件。它们解决的是不同的问题：
>
> - **Embedding**：从大量文档中快速找出可能相关的内容。
> - **Rerank**：对召回的候选内容进行更精细的相关性判断，并重新排序。

理解两者的区别，需要从模型结构、训练方式、检索机制和系统架构几个方面展开。

---

## 一、Embedding 模型是什么？

Embedding 模型的作用是将文本转换为固定维度的稠密向量，使语义相近的文本在向量空间中尽可能接近。

**示例流程：**

```
用户 Query
"如何取消 iPhone 的自动续费？"
        ↓
Embedding 模型
文本编码为向量
[-0.12, 0.38, 0.07, ..., 0.21]
        ↓
向量检索
在文档向量库中查找相似向量，返回 Top-K 候选文档
```

### 1. Embedding 的基本原理

常见的文本 Embedding 模型通常基于 Transformer 架构，典型处理流程如下：

1. **Tokenization**：将文本切分为 Token。
2. **Transformer 编码**：通过多层注意力机制提取上下文语义特征。
3. **Pooling**：将多个 Token 的隐藏状态聚合成一个固定长度的文本向量，例如使用 Mean Pooling 或 CLS Token。
4. **可选归一化**：对向量进行 L2 归一化，便于后续相似度计算。

假设最终输出的向量维度是 768，那么一段文本就可以表示为：

$$e \in \mathbb{R}^{768}$$

不同模型的输出维度可能是 384、768、1024 或其他值。

> ⚠️ **注意**：Pooling 并不是所有模型都采用相同的方式，实际使用时应遵循模型自身的配置。

### 2. Embedding 如何衡量文本相似度？

常见方法有三种：

| 方法 | 说明 |
|------|------|
| **Cosine Similarity（余弦相似度）** | 比较两个向量的方向 |
| **Dot Product（点积）** | 衡量向量的内积 |
| **Euclidean Distance（欧氏距离）** | 衡量两个向量的空间距离 |

余弦相似度的公式为：

$$\text{sim}(q, d) = \frac{q \cdot d}{\|q\| \|d\|}$$

其中：

- $q$：Query 的向量。
- $d$：Document 的向量。

向量相似度越高，通常意味着文本在模型学习到的语义空间中越接近，但**不一定意味着文档能够准确回答用户的问题**。

### 3. Embedding 是如何训练的？

Embedding 模型通常先通过大规模文本进行预训练，再使用面向语义检索的任务数据进行训练或微调。一种典型方法是**对比学习（Contrastive Learning）**。

**训练数据通常包含：**

- **Query**：用户提出的问题。
- **Positive**：与问题相关的文档。
- **Negative**：与问题无关的文档。
- **Hard Negative**：表面上很相似，但实际上不能很好回答问题的文档。

**示例：**

| 类型 | 文本 |
|------|------|
| Query | 如何取消 iPhone 自动续费？ |
| Positive | 在 iPhone 的 Apple 账户订阅设置中取消订阅。 |
| Negative | 如何在 iPhone 上更换壁纸？ |
| Hard Negative | 如何查看 iPhone 上正在进行的订阅？ |

Hard Negative 尤其重要，因为它与问题主题接近，却未必能直接解决用户的需求。

模型通过对比学习，使 Query 与 Positive 的向量更加接近，同时拉开与 Negative 的距离。常见的损失函数包括 **InfoNCE**、**Contrastive Loss** 和 **Multiple Negatives Ranking Loss** 等。

以 InfoNCE 为例，其目标可以简化表示为：

$$L = -\log \frac{\exp(s(q, d^+)/\tau)}{\sum_j \exp(s(q, d_j)/\tau)}$$

其中：

- $d^+$：正样本文档。
- $d_j$：候选样本。
- $s(q, d)$：Query 与文档的相似度分数。
- $\tau$：温度参数。

训练的本质是优化向量空间，让相关文本更容易被检索到。

> 💡 **关键点**：Embedding 模型并非天生就懂得如何进行特定业务的语义检索。训练数据和训练目标会直接影响它的检索效果。

---

## 二、Rerank 模型是什么？

Rerank，也称重排序模型，用于对初步检索得到的候选文档进行二次评分和排序。它通常不负责从整个文档库中检索所有相关文档，而是接收前置检索系统返回的候选集合。

**示例：** Embedding 先从 100 万篇文档中召回 100 篇，Rerank 再对这 100 篇进行精细排序。

### 1. Rerank 的基本原理

常见的 Rerank 模型采用 **Cross-Encoder（交叉编码器）** 架构。与 Embedding 分别编码 Query 和 Document 不同，Cross-Encoder 将两者一起输入模型：

```
[CLS] Query [SEP] Document [SEP]
```

**示例输入：**

```
Query:
如何取消 iPhone 的自动续费？

Document:
用户可以进入 Apple 账户的订阅管理页面，
选择对应的订阅并取消续订。
```

模型通过 Transformer 的自注意力机制，让 Query 与 Document 的 Token 直接交互，随后输出一个相关性分数。

**典型结构：**

```
Query（用户问题） + Document（候选文档）
        ↓
Cross-Encoder（联合编码、细粒度交互）
        ↓
相关性分数 0.92（示意值，不代表通用概率）
```

这里的分数用于同一排序任务中的候选文档比较。它通常不是经过校准的概率，也不能假设不同 Rerank 模型的分数可以直接比较。

### 2. Rerank 是如何训练的？

Rerank 模型通常使用标注好的 Query-Document 相关性数据进行训练。常见训练方式包括：

| 训练方法 | 核心思想 |
|----------|----------|
| **Pointwise** | 单独判断每个 Query-Document 对的相关性 |
| **Pairwise** | 学习相关文档的分数应高于不相关文档 |
| **Listwise** | 直接优化一组候选文档的整体排序质量 |

**Pointwise 训练**可以使用二元交叉熵损失：

$$L_{BCE} = -[y \log p + (1-y) \log(1-p)]$$

其中，$y$ 是相关性标签，$p$ 是模型输出经过相应变换后的预测值。

**Pairwise 训练**则可以要求：

$$s(q, d^+) > s(q, d^-)$$

也就是让正样本的相关性分数高于负样本。

> ⚠️ 训练数据的质量非常关键。假如训练集只能区分完全无关和明显相关的文档，模型可能仍然难以区分两篇主题相近、但回答质量不同的文档。

---

## 三、为什么有了 Embedding，还需要 Rerank？

这是两者最重要的区别：**Embedding 优先解决检索效率问题，Rerank 优先解决排序精度问题。**

### 1. 两种模型的核心区别

| 维度 | Embedding | Rerank |
|------|-----------|--------|
| 常见架构 | Bi-Encoder，双编码器 | Cross-Encoder，交叉编码器 |
| 输入方式 | Query、Document 分别编码 | Query 与 Document 联合输入 |
| 文本交互 | 编码阶段不直接交互 | 编码阶段直接交互 |
| 文档向量 | 通常需要预先计算并存储 | 通常不需要预先计算文档向量 |
| 检索范围 | 适合整个大规模文档库 | 通常只处理候选文档 |
| 计算成本 | 单次检索成本相对较低 | 每个 Query-Document 对都要计算 |
| 主要作用 | 召回候选文档 | 精排候选文档 |
| 常见用途 | 大规模语义搜索、RAG 召回 | 搜索结果排序、RAG 精排 |

### 2. Embedding 为什么可能排错？

假设用户询问：**"如何取消 iPhone 的自动续费？"**

向量检索可能召回以下文档：

| 候选文档 | 语义相似程度 | 对问题的帮助 |
|----------|--------------|--------------|
| A：如何取消 iPhone 自动续费 | 高 | 直接解决问题 |
| B：如何查看 iPhone 的订阅记录 | 高 | 相关，但不一定解决问题 |
| C：如何在 iPhone 上管理 Apple 账户 | 较高 | 相关，但范围更宽 |
| D：如何更换 iPhone 壁纸 | 较低 | 基本无关 |

A、B、C 都涉及 iPhone、订阅或账户管理，因此向量可能将它们排在相近的位置。但用户真正需要的是**取消自动续费的具体操作方法**。

Rerank 可以在联合分析 Query 与每篇文档后，进一步判断：

- 文档是否直接回应了用户的问题。
- 是否包含关键操作步骤。
- 文档讨论的是取消订阅，还是仅查看订阅。
- 文档是否存在主题相关但答案不匹配的情况。

因此，Rerank 的价值不只是再次计算相似度，而是通过**更细粒度的交互**，对候选文档进行更有针对性的相关性判断。

### 3. 为什么不直接用 Rerank 检索整个文档库？

假设文档库有 100 万篇文档：

- **Embedding** 可以预先计算文档向量，借助向量索引快速检索。
- **Rerank** 通常需要对每个候选文档分别执行一次 Query-Document 联合推理。

如果对 100 万篇文档全部执行 Rerank，计算成本和延迟通常会很高。

**所以，常见的工程方案是：**

1. 使用 Embedding 从海量文档中快速召回。
2. 只对召回的 Top-K 候选文档执行 Rerank。
3. 将排序靠前的文档交给大语言模型生成答案。

---

## 四、Embedding + Rerank 在 RAG 中的完整流程

```
1. 文档预处理
   切分文档、清洗文本、添加元数据
        ↓
2. Embedding 编码
   为文档生成向量并写入向量索引
        ↓
3. 用户提出 Query
   对 Query 编码，执行向量检索
        ↓
4. 召回候选文档（Top 50–100）
   示例数量，实际应通过实验确定
        ↓
5. Rerank 精排
   逐个计算 Query-Document 相关性分数
        ↓
6. 选择最终上下文（Top 3–10）
   示例数量，取决于上下文窗口与任务
        ↓
7. LLM 生成答案
   根据筛选后的文档回答问题
```

> 📌 这里的 Top-K 只是常见的起始配置，不是固定标准。实际参数需要结合文档库规模、查询类型、延迟预算和评测结果进行调整。还可以在 Embedding 召回前后加入关键词检索、元数据过滤或混合检索，以提高召回覆盖率。

---

## 五、Python 实现示例

下面使用 `sentence-transformers` 演示两阶段检索。代码结构适合用于理解原理，实际项目中还需要考虑索引、批处理、设备选择和错误处理。

### 1. 使用 Embedding 召回候选文档

```python
from sentence_transformers import SentenceTransformer
import numpy as np

documents = [
    "在 iPhone 的订阅设置中选择对应项目并取消订阅。",
    "可以在 Apple 账户中查看当前订阅状态。",
    "打开 iPhone 设置可以更换壁纸。",
    "Apple 账户支持管理付款方式和订阅信息。",
]

embedding_model = SentenceTransformer("BAAI/bge-small-en-v1.5")

# 离线阶段：计算文档向量
doc_embeddings = embedding_model.encode(documents, normalize_embeddings=True)

query = "如何取消 iPhone 的自动续费？"
query_embedding = embedding_model.encode(query, normalize_embeddings=True)

# 向量已归一化，因此点积等价于余弦相似度
scores = doc_embeddings @ query_embedding
top_k = 3
candidate_indices = np.argsort(scores)[::-1][:top_k]
candidates = [documents[i] for i in candidate_indices]
```

> ⚠️ 该示例使用的是英文 BGE 模型，虽然代码可以运行，但对于中文业务，应该优先选择经过验证的中文或多语言 Embedding 模型。

### 2. 使用 Rerank 重新排序

可以使用 BGE Reranker 系列模型：

```python
from sentence_transformers import CrossEncoder

reranker = CrossEncoder("BAAI/bge-reranker-v2-m3")

query = "如何取消 iPhone 的自动续费？"
pairs = [(query, doc) for doc in candidates]

rerank_scores = reranker.predict(pairs)
ranked_results = sorted(
    zip(candidates, rerank_scores),
    key=lambda x: x[1],
    reverse=True
)

for doc, score in ranked_results:
    print(f"{score:.4f}", doc)
```

> 📌 这里的 Embedding 模型和 Rerank 模型分别承担召回和精排任务。示例中的模型组合只是演示，部署时应检查模型卡、依赖版本、输入格式和硬件要求。

---

## 六、实际项目中如何选择？

不必默认所有 RAG 系统都需要 Rerank。是否使用，应通过检索质量与系统成本的评测来决定。

| 场景 | 建议 |
|------|------|
| 文档库很小，查询简单 | 可以先只用 Embedding |
| 文档量大，要求低延迟 | 先用 Embedding 召回 |
| 候选文档主题相近，容易混淆 | 优先评估 Rerank |
| 业务问题要求精确匹配操作步骤 | 通常值得评估 Rerank |
| 系统对延迟和推理成本非常敏感 | 评估 Rerank 带来的收益是否足够 |
| 召回阶段经常找不到正确文档 | 先改善召回，不能只依赖 Rerank |

> ⚠️ **一个特别重要的边界**：Rerank 只能重新排序**已经召回**的文档，不能可靠地找回完全没有进入候选集的正确文档。因此，如果正确文档在 Embedding 的 Top-K 之外，即使 Rerank 很强，也无法直接将其排到前面。此时需要改善 Embedding、调整召回数量、使用混合检索或优化文档切分。

**建议重点监控以下指标：**

- **Recall@K**：正确文档是否进入前 K 个候选。
- **MRR / NDCG@K**：相关文档的排序质量。
- **最终回答质量**：LLM 是否基于检索内容准确回答。
- **延迟与成本**：引入 Rerank 后的实际开销。

---

## 七、最后总结

Embedding 和 Rerank 并不是两个互相替代的模型，而是**分工不同、可以互补**的检索组件。

| 组件 | 角色 | 说明 |
|------|------|------|
| **Embedding** | 召回 | 将文本编码为向量，通过高效的向量检索从大规模文档库中找到可能相关的候选内容。 |
| **Rerank** | 精排 | 联合分析 Query 与候选 Document，进行更细粒度的相关性判断，提高前排结果的质量。 |
| **LLM** | 生成 | 根据最终筛选出的上下文生成答案。检索质量会影响答案质量，但不能保证答案一定正确。 |

> 🎯 **记住一个核心原则**：
>
> **Embedding 决定正确答案有没有机会被找到；Rerank 决定已经找到的候选内容，哪些应该排在前面。**