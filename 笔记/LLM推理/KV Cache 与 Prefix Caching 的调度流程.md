# KV Cache 与 Prefix Caching 的调度流程

## 一、KV Cache 是什么

### 1.1 从注意力计算说起

Transformer 的注意力计算是：

```
Attention(Q, K, V) = softmax(QKᵀ / √d) · V
```

生成第 `t` 个 token 时，模型需要拿当前 token 的 Query，去和前面所有 token 的 Key 做点积，再用结果加权所有 Value。

**如果没有 KV Cache**，每生成一个新 token，都要把前面所有 token 的 K 和 V 重新算一遍。生成 128 个 token，就要重算 128 次前缀。

**有了 KV Cache**，前面 token 的 K 和 V 算过一次就存下来。生成新 token 时，只算当前 token 的 Q、K、V，把新的 K、V 追加到缓存里，然后拿当前 Q 去和缓存里所有 K 做注意力。

```
无 KV Cache：每步计算量 ∝ 序列长度²
有 KV Cache：每步计算量 ∝ 序列长度（只算当前 token 的 QKV + 注意力）
```

KV Cache 是自回归推理能跑起来的基础设施。没有它，长序列生成会慢到不可用。

### 1.2 KV Cache 在哪个流程中用到

KV Cache 贯穿推理的两个阶段：**prefill 阶段写入，decode 阶段读取和追加**。

**Prefill 阶段：写入 KV Cache**

请求到达后，模型先把整段 prompt 过一遍。这一步叫 prefill。

- 输入：prompt 的所有 token
- 计算：每一层都对所有 token 算 K 和 V
- 输出：最后一个 token 位置的隐藏状态，用来采样第一个生成 token
- **副作用：每一层的 K 和 V 被写入 KV Cache**

Prefill 是并行的，所有 prompt token 一次算完。这一步的 KV 写入量 = prompt 长度 × 每 token KV 字节数 × 层数。

**Decode 阶段：读取 KV Cache，追加新 KV**

Prefill 完，开始逐 token 生成。每生成一个 token：

1. 当前 token 过模型，算出当前层的 Q、K、V
2. **当前 token 的 K、V 追加到 KV Cache**
3. 当前 token 的 Q 去和 KV Cache 里**所有** K 做注意力
4. 用注意力权重加权 KV Cache 里**所有** V
5. 输出下一个 token 的隐藏状态，采样

**每一步 decode 都要读一遍整个 KV Cache。** 序列越长，读的 KV 越多，decode 越慢。这就是为什么长上下文解码会变慢。

### 1.3 KV Cache 和 PagedAttention

vLLM 的核心创新是 **PagedAttention**：把 KV Cache 切成固定大小的 **block**，像操作系统管理内存页一样管理。

- 每个 block 存固定数量 token 的 K 和 V（默认 `block_size = 16`）
- block 在物理显存里不要求连续
- `block_table` 记录逻辑位置到物理 block 的映射
- 多个请求可以共享同一个物理 block（Prefix Caching 的基础）

```
block 数量 = KV cache 字节数 / 每个 block 字节数
每个 block 字节数 = block_size × num_kv_heads × head_dim × 2(K和V) × dtype_bytes
```

---

## 二、Prefix Caching 是什么

### 2.1 它不是一个独立的缓存

**Prefix Caching 不是独立于 KV Cache 的另一个缓存，它是对已有 KV block 的复用策略。**

- KV Cache 是物理实体：显存里存 K 和 V 的 block。
- Prefix Caching 是调度策略：当新请求的前缀和已有 block 的 hash 匹配时，直接复用那些 block，不重新计算。

所以：

- 没有 Prefix Caching，KV Cache 只存正在运行的请求的 KV，请求结束就释放。
- 有 Prefix Caching，请求结束后 KV block 不立即清空，留在池子里等后续请求命中。命中了就复用，没命中就被 LRU 淘汰。

### 2.2 Block Hash

vLLM 对每个**填满的** KV block 计算一个 hash 值，hash 的输入是“该 block 前面的所有 token + 该 block 内的 token”。

```
hash(prefix tokens + block tokens) <--> KV Block
```

举例：`block_size = 16`。

- Block 1 的 hash 基于“block 1 内的 16 个 token”
- Block 2 的 hash 基于“block 1 的全部 token + block 2 内的 16 个 token”
- Block 3 的 hash 基于“block 1 + block 2 的全部 token + block 3 内的 16 个 token”

**只有完全相同的 token 序列，才会产生相同的 hash。** 任何位置的 token 不同，后续所有 block 的 hash 都会改变。

**Block 是匹配的最小单位。** 即使两条请求在某个 block 中间才分叉（比如前 10 个 token 相同，第 11 个开始不同），这个 block 也不会被缓存，因为 vLLM 只缓存“填满的 block”。

### 2.3 一个请求进来时发生什么

**第一步：查找可复用的 Block**

新请求到达时，调度器计算它第一个 block 的 hash，去全局 hash 表里查找。

- **命中**：说明缓存中有完全相同的 token 序列的 block。vLLM 把这个物理 block 的引用计数加一，**跳过这部分 token 的 prefill 计算**。
- **未命中**：按普通流程处理，从第一个 token 开始 prefill。

命中的 block 数量取决于**从开头开始连续匹配的长度**。如果第 1 个 block 命中、第 2 个命中、第 3 个不命中，那么只能复用前 2 个 block 的 KV，第 3 个开始需要重新计算。

**第二步：为未命中的部分分配新 Block**

对于未命中的部分，vLLM 按正常 prefill 流程，从空闲 block 队列中分配新的物理 block，计算 KV 并写入。

**这里有一个关键约束**：如果开启了 chunked prefill，Prefix Caching 的查找**只在第一个 chunk 执行**。也就是说，如果一个请求的 prompt 被切成多个 chunk，只有第一个 chunk 的开头部分会去查 Prefix Caching，后续 chunk 不再查。

**第三步：解码阶段的 Block 增长**

请求进入 decode 后，每生成一个 token，如果当前 block 满了，就分配一个新 block。新 block 的 hash 基于“之前所有 token + 新 block 内的 token”计算，并加入全局 hash 表，**未来可能有其他请求复用它**。

### 2.4 引用计数

每个物理 KV block 有一个 `ref_cnt`，记录**当前有多少个请求正在使用这个 block**。

- 一个请求独占一个 block 时，`ref_cnt = 1`
- 另一个请求命中了相同前缀的 block 时，`ref_cnt` 变成 2
- 当一个请求结束，它释放自己引用的所有 block，对应的 `ref_cnt` 减一
- **只有当 `ref_cnt` 降到 0 时，这个 block 才会被放回空闲队列**，可能被后续请求复用，也可能被淘汰

这就是 Prefix Caching 能“记住”已经结束的请求的前缀的原因：**请求虽然结束了，但它的 block 因为 hash 还在表里，ref_cnt 归 0 后并没有被立即清空**，而是留在池子里等待下一个命中。

### 2.5 淘汰策略

当空闲 block 耗尽、需要给新请求分配 block 时，vLLM 按以下优先级淘汰：

1. **优先淘汰 `ref_cnt = 0` 的 block**：即没有活跃请求在用的 block。正在被请求使用的 block（`ref_cnt > 0`）不会被淘汰。
2. **在 `ref_cnt = 0` 的 block 中，优先淘汰 LRU**（最近最少使用的）。
3. **如果多个 block 的最后访问时间相同，优先淘汰“位于最长前缀末尾”的 block**——也就是说，越“叶子”的 block 越先被淘汰，保留更靠近根部的共享前缀。

这套策略的效果是：**被多个请求共享的长系统提示词的前缀 block，因为访问频繁，最不容易被淘汰；而只在少数请求末尾出现的 block，最先被回收。**

### 2.6 Prefix Caching 不改变什么

- **不改变单路解码速度**。它只减少 prefill 计算量，降低 TTFT，不改变 TPOT。
- **不改变 KV 容量**。它复用已有 block，不额外占显存。
- **不改变输出结果**。它只是跳过重复计算，KV 值本身不变。

---

## 三、示例：前缀不重复时，Prefix Caching 为什么帮不上忙

用一个具体例子把上面的机制串起来。示例参数如下，**不是任何一次真实测试的结果，只是用来演示计算方式**。

### 3.1 示例配置

| 项目 | 值 |
|---|---|
| `block_size` | 16 |
| prompt 长度 | 536 token |
| 请求数 | 4 条 |
| 前缀 | 随机、不重复 |

### 3.2 每条请求的 Block 划分

536 token 需要：

```
ceil(536 / 16) = 34 个 block
```

4 条请求，每条 34 个 block，共 136 个 block。

### 3.3 Hash 匹配结果

每条请求的每个 block hash 都是唯一的，因为前缀不重复：

| 请求 | Block 1 hash | Block 2 hash | … | Block 34 hash |
|---|---|---|---|---|
| 请求 A | hash_A1 | hash_A2 | … | hash_A34 |
| 请求 B | hash_B1 | hash_B2 | … | hash_B34 |
| 请求 C | hash_C1 | hash_C2 | … | hash_C34 |
| 请求 D | hash_D1 | hash_D2 | … | hash_D34 |

**没有任何一个 hash 是相同的。** 请求 B 的第一个 block hash 和请求 A 的第一个 block hash 不同，后续更不可能相同。

### 3.4 调度流程

**请求 A 到达**：

- 查 hash 表，空，全部未命中。
- 分配 34 个新 block，执行 prefill 536 token。
- 34 个 block 写入 hash 表，`ref_cnt = 1`。
- 进入 decode。

**请求 B 到达**：

- 查 hash 表，`hash_B1` 不在表里，未命中。
- 分配 34 个新 block，执行 prefill 536 token。
- 34 个 block 写入 hash 表，`ref_cnt = 1`。
- 进入 decode。

**请求 C、D 同理。**

### 3.5 结果

| 请求 | 命中 block 数 | prefill token 数 |
|---|---|---|
| A | 0 | 536 |
| B | 0 | 536 |
| C | 0 | 536 |
| D | 0 | 536 |

**Prefix Caching 完全没有生效。** 每条请求都要完整 prefill 自己的 536 token。

### 3.6 请求结束后

请求 A 结束：

- 它引用的 34 个 block，`ref_cnt` 从 1 降到 0。
- 这些 block 留在池子里，等待命中。
- **但永远不会有第二个请求来命中它们**，因为前缀不重复。
- 当空闲 block 不足时，这些 block 按 LRU 被淘汰。

**这就是“前缀不重复，缓存帮不上忙”的原理**：hash 全部唯一，没有复用，Prefix Caching 只是白白占着 block 等一个永远不会来的命中。

---

## 四、Prefix Caching 与 KV Cache 的关系

把两者放在一起：

| 维度 | KV Cache | Prefix Caching |
|---|---|---|
| 是什么 | 物理实体：存 K 和 V 的 block | 调度策略：复用已有 block |
| 何时写入 | prefill 写 prompt 的 KV，decode 追加新 KV | 不写入，只复用 |
| 何时读取 | 每步 decode 读全部 KV | 请求到达时查 hash 表 |
| 何时释放 | 请求结束，ref_cnt 减一 | ref_cnt 归 0 的 block 留在池子里 |
| 影响 TTFT | prefill 写入 KV 的时间 | 命中时跳过 prefill，降低 TTFT |
| 影响 TPOT | 每步读 KV 的时间 | 不改变 TPOT |
| 占显存 | 是 | 复用已有 block，不额外占 |

**一句话**：KV Cache 是“存什么”，Prefix Caching 是“怎么复用”。两者是同一块显存上的两个视角。

---

## 五、一句话总结

**KV Cache 是自回归生成时缓存的 Key 和 Value 张量，prefill 阶段写入，decode 阶段每步读取并追加，避免重复计算前缀。vLLM 用 PagedAttention 把它切成固定大小的 block，用引用计数管理共享，用 LRU 淘汰冷数据。Prefix Caching 不是独立于 KV Cache 的另一个缓存，它就是对已有 KV block 的复用策略：新请求的 block hash 与全局 hash 表匹配时，直接复用物理 block、跳过 prefill。匹配是 token 级精确的，只有完全相同的 token 序列才能命中。前缀不重复时，所有 hash 唯一，Prefix Caching 不生效。**