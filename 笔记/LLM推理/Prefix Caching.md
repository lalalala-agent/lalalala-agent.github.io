# 系统提示词大部分相同时的 Prefix Caching 调度流程

## 一、场景设定

实际服务中，很多请求共享同一段系统提示词。典型结构：

```
[系统提示词 L_sys token] + [用户输入 L_user token] = 总 prompt L_total token
```

示例参数如下，**不是任何一次真实测试的结果，只是用来演示计算方式**。

| 项目 | 值 |
|---|---|
| `block_size` | 16 |
| 系统提示词 `L_sys` | 2000 token |
| 用户输入 `L_user` | 536 token |
| 总 prompt `L_total` | 2536 token |
| `max_num_batched_tokens` | 2048 |
| 请求数 | 4 条 |
| 系统提示词 | 4 条完全相同 |
| 用户输入 | 4 条各不相同 |

4 条请求的结构：

```
请求 A：[系统提示词 2000] + [用户输入 A 536]
请求 B：[系统提示词 2000] + [用户输入 B 536]
请求 C：[系统提示词 2000] + [用户输入 C 536]
请求 D：[系统提示词 2000] + [用户输入 D 536]
```

---

## 二、第一个请求：完整 Prefill，写入 Hash 表

**请求 A 到达，总 prompt 2536 token。**

### 2.1 查找 Prefix Caching

调度器计算请求 A 第一个 block 的 hash，去全局 hash 表查找。**此时缓存是空的，全部未命中。**

### 2.2 分配新 Block，执行 Prefill

从空闲队列分配 block。2536 token 需要：

```
ceil(2536 / 16) = 159 个 block
```

`max_num_batched_tokens = 2048`，prefill 分步：

- **第 1 步**：算前 2048 token。前 2000 token 是系统提示词，后 48 token 是用户输入开头。填满前 128 个 block（2048 / 16 = 128）。
- **第 2 步**：算剩余 488 token。填满后续 31 个 block（488 / 16 ≈ 30.5，最后一个 block 未满）。

### 2.3 写入 Hash 表

每当一个 block 被填满，vLLM 计算它的 hash 并写入全局 hash 表。

| Block | Hash 输入 | 是否与用户输入有关 |
|---|---|---|
| 1 | 系统提示词第 1–16 token | 无关 |
| 2 | 系统提示词第 1–32 token | 无关 |
| … | … | 无关 |
| 125 | 系统提示词第 1–2000 token | 无关 |
| 126 | 系统提示词 2000 + 用户输入第 1–16 token | 有关 |
| … | … | 有关 |
| 128 | 系统提示词 + 用户输入前 2048 token | 有关 |
| 159 | 全部 2536 token | 有关 |

**关键点**：前 125 个 block（覆盖整个系统提示词 2000 token）的 hash **只依赖系统提示词本身**，和用户输入无关。这 125 个 block 的 hash 对所有请求都是一样的。

### 2.4 解码阶段

请求 A 进入 decode，每生成一个 token 就写 KV，block 满则分配新 block。这些新 block 的 hash 也写入表，但因为它们位于用户输入和输出之后，不会被后续请求复用。

---

## 三、第二个请求：命中前 125 个 Block

**请求 B 到达，系统提示词与 A 完全相同，用户输入不同。**

### 3.1 查找 Prefix Caching

调度器计算请求 B 第一个 block 的 hash：

```
hash(系统提示词第 1–16 token)
```

这个 hash **和请求 A 的第一个 block hash 完全相同**。命中。

继续查第二个 block：

```
hash(系统提示词第 1–32 token)
```

和请求 A 的第二个 block hash 相同。命中。

**这个过程一直持续到第 125 个 block。** 因为前 125 个 block 的 hash 只依赖系统提示词，而 B 的系统提示词和 A 完全一样，所以这 125 个 block 全部命中。

到了第 126 个 block：

```
hash(系统提示词 2000 + 用户输入第 1–16 token)
```

请求 B 的用户输入和 A 不同，这个 hash 和 A 的第 126 个 block hash **不同**。未命中。

**匹配到此为止。** 请求 B 复用了前 125 个 block 的 KV，即整个系统提示词的 2000 token。

### 3.2 为未命中部分分配新 Block

请求 B 只需要为“用户输入 536 token”分配新 block：

```
ceil(536 / 16) = 34 个 block
```

这 34 个 block 从空闲队列分配，执行 prefill。

### 3.3 Prefill 计算量对比

| 请求 | 系统提示词 prefill | 用户输入 prefill | 总 prefill |
|---|---|---|---|
| A（第一个） | 2000 token | 536 token | 2536 token |
| B（后续） | 0（命中复用） | 536 token | 536 token |

**请求 B 省掉了 2000 token 的 prefill 计算，节省约 79%。**

### 3.4 引用计数

请求 A 的前 125 个 block，`ref_cnt` 从 1 变成 2。请求 B 和请求 A 共享这 125 个物理 block。

---

## 四、后续请求与引用计数变化

**请求 C、D 陆续到达**，系统提示词相同。

每个请求都会命中前 125 个 block，`ref_cnt` 依次变成 3、4。

### 4.1 请求结束时发生什么

**请求 A 结束**：

- A 释放自己引用的所有 block。
- 前 125 个 block 的 `ref_cnt` 减一（从 4 变成 3），**因为还有 B、C、D 在用，不会被回收**。
- A 独有的用户输入和输出部分的 block，`ref_cnt` 归 0，回到空闲队列。

**所有请求都结束**：

- 前 125 个 block 的 `ref_cnt` 归 0。
- 但它们**不会立即被清空**，而是留在池子里。
- 下一个新请求到来时，如果系统提示词相同，仍然能命中这 125 个 block，**不需要重新 prefill 系统提示词**。

### 4.2 什么时候会被淘汰

如果长时间没有新请求命中这 125 个 block，且空闲 block 不足，它们会按 LRU 被淘汰。但只要系统提示词还在被使用，这些 block 的访问时间总是很新，**最不容易被淘汰**。

---

## 五、TTFT 的变化

回到调度流程的核心问题：Prefix Caching 怎么影响 TTFT。

### 5.1 无 Prefix Caching

**并发 2，两条请求都带 2000 token 系统提示词**：

```
两条合计 = 2 × 2536 = 5072 token
```

`max_num_batched_tokens = 2048`：

```
prefill 步数 = ceil(5072 / 2048) = 3 步
TTFT ≈ T_固定 + 3 × f(2048) + 排队
```

### 5.2 有 Prefix Caching，但第一批请求

缓存还是空的，两条都要算完整 2536 token：

```
和无 Prefix Caching 一样，3 步
```

### 5.3 有 Prefix Caching，且系统提示词已在缓存中

两条各只需算 536 token 用户输入：

```
两条合计 = 2 × 536 = 1072 token
```

`1072 < 2048`，**一步 prefill 完**：

```
TTFT ≈ T_固定 + f(1072)
```

**和无缓存时的 3 步相比，TTFT 大幅下降。**

### 5.4 对比表

| 场景 | prefill token 数 | prefill 步数 | TTFT |
|---|---|---|---|
| 无 Prefix Caching，并发 2 | 5072 | 3 | 高 |
| 有缓存，第一批，并发 2 | 5072 | 3 | 高 |
| 有缓存，命中后，并发 2 | 1072 | 1 | 低 |

**Prefix Caching 对 TTFT 最直接的影响**：把“每条请求都要算系统提示词”变成“只有第一个请求算，后续请求直接复用”，让同一步里的 prefill token 数大幅减少。

---

## 六、Chunked Prefill 与 Prefix Caching 的交互

如果开启了 chunked prefill（默认开启），有一个关键细节：

**Prefix Caching 的查找只在第一个 chunk 执行。**

假设请求 prompt 2536 token，`max_num_batched_tokens = 2048`，需要切 2 个 chunk：

**第 1 个 chunk**：2048 token。

- 调度器先查 Prefix Caching，命中前 125 个 block（2000 token）。
- 这 125 个 block 直接复用，不需要计算。
- 剩余 48 token（用户输入开头）需要计算。
- 这一步实际只算 48 token。

**第 2 个 chunk**：488 token。

- **不再查 Prefix Caching**，直接计算。

所以有 Prefix Caching 时，请求 B 的 prefill 实际计算量：

```
第 1 chunk：48 token（系统提示词命中，用户输入开头 48 token）
第 2 chunk：488 token（用户输入剩余）
合计：536 token
```

和无 Prefix Caching 时的 2536 token 相比，节省了 2000 token。

---

## 七、Block 的回收与淘汰

在有共享系统提示词的场景下，前 125 个 block 的 `ref_cnt` 通常很高（等于活跃请求数）。**只要还有请求在用，它们就不会被淘汰。**

当活跃请求数降为 0，这 125 个 block 的 `ref_cnt` 归 0，但仍在池子里。如果此时空闲 block 不足，vLLM 按 LRU 淘汰。**共享系统提示词的 block 因为访问频繁，最后访问时间总是很新，所以最不容易被淘汰。** 只有长期没有新请求命中它们，才会被回收。

---

## 八、使用 Prefix Caching 的注意事项

### 8.1 让系统提示词尽量长

至少填满多个 block（16 token 一个），命中的粒度更粗，收益更大。2000 token 的系统提示词能命中 125 个 block，收益显著。

### 8.2 确保系统提示词的 token 序列完全一致

任何 token 不同（包括空格、换行、标点），都会导致后续所有 block 的 hash 改变，命中失败。

### 8.3 注意系统提示词和用户输入的边界

用户输入的第一个 block 因为和系统提示词拼在一起，hash 会变，不会被复用。这没关系，因为用户输入本来每条都不同。

### 8.4 冷启动要预热

Prefix Caching 只对“已经缓存过的前缀”有效，冷启动时第一批请求没有收益。可以在服务启动后先打几条预热请求，把系统提示词的 block 写进缓存。

### 8.5 Prefix Caching 不改变单路解码速度

它只减少 prefill 计算量，降低 TTFT，不改变 TPOT。单路解码速度由带宽和算力决定，Prefix Caching 帮不上忙。

### 8.6 系统提示词长度和 Block 边界

如果系统提示词的 token 数不是 16 的整数倍，最后一个 block 会包含系统提示词结尾和用户输入开头。这个 block 的 hash 依赖用户输入，**不会被后续请求命中**。所以系统提示词长度最好对齐到 block 边界，让最后一个系统提示词 block 完全由系统提示词组成。

---

## 九、一句话总结

**系统提示词大部分相同时，Prefix Caching 的调度流程是：第一个请求完整 prefill 系统提示词并写入 block hash 表；后续请求按 block 逐级匹配 hash，命中则直接复用 KV、跳过 prefill，未命中部分（用户输入）才分配新 block 计算。命中粒度是 block（16 token），匹配要求 token 级完全一致。引用计数保证共享 block 在有请求使用时不被回收，LRU 保证长期不用的 block 最终被淘汰。系统提示词越长、越一致、越对齐 block 边界，命中收益越大。冷启动时第一批请求没有收益，需要预热。Prefix Caching 只降低 TTFT，不改变 TPOT。**