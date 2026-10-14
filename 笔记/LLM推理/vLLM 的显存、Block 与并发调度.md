# vLLM 的显存、Block 与并发调度

## 一、显存怎么分：从总显存到 KV Block

### 1.1 显存的三层拆分

vLLM 启动时，把 GPU 显存分成三块：

| 层 | 内容 |
|---|---|
| 权重和非 torch | 模型权重、CUDA context、框架固定开销 |
| 峰值激活 | 按 `max-model-len` 做 profile 时测得的最大中间激活 |
| KV cache | 剩下的全部给 KV block |

`gpu-memory-utilization` 控制的是**总预算**。权重和激活先占，剩下的才给 KV：

```
总预算 = 可见显存 × gpu-memory-utilization
KV cache = 总预算 − 权重 − 激活
```

**关键点**：权重是固定的，激活由 `max-model-len` 和 `max-num-batched-tokens` 决定，只有 KV cache 是“弹性”的。调 `gpu-memory-utilization`，调的就是 KV 这块的大小。

### 1.2 KV Block 的大小

vLLM 用 PagedAttention 管理 KV cache，把 KV 切成固定大小的 **block**。

| 项目 | 说明 |
|---|---|
| `block_size` | vLLM 默认 16 token |
| 每个 block 存什么 | 16 个 token 的 K 和 V，覆盖所有全注意力层 |
| 每个 block 字节数 | `block_size × num_kv_heads × head_dim × 2(K和V) × dtype_bytes` |
| block 数量 | `KV cache 字节数 / 每个 block 字节数` |

每个 block 的物理布局：

```
[block_size, num_kv_heads, head_dim] × 2(K和V) × dtype_bytes
```

**block 是 vLLM 管理 KV 的最小单位**。一个请求的上下文在逻辑上是连续的 token 序列，但在物理显存里被切成多个 block，**不要求连续**。`block_table` 记录逻辑位置到物理 block 的映射。

### 1.3 Block 的分配与增长

一个请求的 block 不是一次性全分配的，而是**按需分配**：

- **Prefill 阶段**：prompt 的所有 token 的 KV 写入。`ceil(prompt_len / block_size)` 个 block。
- **Decode 阶段**：每生成一个 token，写一个 token 的 KV。当前 block 满了，就分配一个新 block。

请求结束后，它引用的所有 block 被释放。如果开启了 Prefix Cache，`ref_cnt` 归 0 的 block 不一定立即清空，可能留在池子里等复用。

### 1.4 显存容量和上下文长度的关系

KV 容量决定了能同时容纳多少 token 的上下文：

```
能放下的请求数 = KV token 容量 / 单条请求占用的 token 数
单条请求占用的 token 数 ≈ 输入长度 + 输出长度
```

**放得下不等于能开到那么多**。短请求先被算力限制，长请求才被显存限制。

---

## 二、并发时调度器怎么跑

### 2.1 调度器的四个约束

每一步前向，调度器要决定“这一步算哪些 token”。它受四个约束：

| 约束 | 含义 |
|---|---|
| `max_num_batched_tokens` | 一步最多算多少 token |
| `max_num_seqs` | 一步最多同时处理多少条请求 |
| `max_model_len` | 单条请求输入加输出的上限 |
| 空闲 block 数 | KV 容量决定的硬上限 |

**这四个约束里，哪个先撞上，哪个就是当前瓶颈。**

### 2.2 每一步调度做什么

调度器的核心任务可以概括成一句话：

> **让每个请求的 `num_computed_tokens` 追上它的 `num_tokens`。**

- `num_tokens`：这条请求总共要算多少 token（prompt + 已生成）
- `num_computed_tokens`：已经算过多少 token

每一步，调度器从所有待处理请求里选一批，凑不超过 `max_num_batched_tokens` 的 token 数，执行一次前向。

**优先级**：

1. **正在 decode 的请求优先**。它们每步只贡献 1 个 token，必须让它们持续出字，否则 ITL 会爆炸。
2. **剩余预算给 prefill**。新请求的 prompt 被切成 chunk，填满剩余预算。

### 2.3 调度流程总结

```
每一步：
  1. 优先调度正在 decode 的请求，每条 1 token
  2. 剩余预算 = max_num_batched_tokens − decode token 数
  3. 从待 prefill 请求里选，凑不超过剩余预算
  4. 执行一次前向
  5. 更新 num_computed_tokens
  6. 满了的请求退出，新请求进来
```

### 2.4 并发升高时发生什么

随着并发升高，会发生三件事：

1. **同一步里的 prefill token 变多**。`C × L` 增大，prefill 计算量增大，TTFT 变长。
2. **`C × L` 越过 `max_num_batched_tokens` 后，prompt 被切**。部分请求的 prefill 被拆成多步，TTFT 额外增加排队时间。
3. **decode 请求和 prefill 争预算**。prefill chunk 占用预算时，decode 请求要等这一步结束才有下一个 token，ITL 出现尖峰。

---

## 三、TTFT 由什么决定

### 3.1 TTFT 的三段构成

```
TTFT = 排队等待 + prefill 计算 + 首 token 采样
```

- **排队等待**：请求到了，但这一步预算已被别人占了，要等下一步。
- **prefill 计算**：prompt 过一遍模型，算出 KV。这是 TTFT 的大头。
- **首 token 采样**：prefill 完，出第一个 token 的时间，通常很小。

在无排队、无缓存命中的情况下，TTFT 基本就是 prefill 计算时间。prefill 计算时间和 **prompt token 数**近似成正比。

### 3.2 TTFT 的近似公式

设：

- 单条 prompt 长度 `L`
- 并发 `C`
- 每步 token 预算 `B`（`max_num_batched_tokens`）

**情况一：`C × L ≤ B`**

```
prefill token 数 ≈ C × L
TTFT ≈ T_固定 + f(C × L)
```

`f` 是 prefill 时间函数，近似线性，斜率随 token 数增大略降。

**情况二：`C × L > B`**

```
prefill 步数 ≈ ceil(C × L / B)
TTFT ≈ T_固定 + prefill 步数 × f(B) + 排队等待
```

**TTFT 取决于两件事**：

1. 同一步里塞了多少 prefill token（由 `C × L` 和 `B` 共同决定）。
2. 要切几步（由 `C × L / B` 决定）。

### 3.3 短提示词为什么 TTFT 基本不变

假设 prompt 只有 50 token：

- 并发 1：prefill 50 token。
- 并发 2：prefill 100 token。
- 并发 4：prefill 200 token。

**100 token、200 token 的 prefill 只有几毫秒到十几毫秒。** 在 TTFT 的几百毫秒里，prefill 只占很小一块，剩下的是固定开销（调度、采样、框架、网络）。**固定开销不随并发变，所以 TTFT 基本不变。**

而 536 token 的 prompt，prefill 本身就是几百毫秒，翻倍就是几百毫秒的差别。

**关键不是“并发几条”，而是“这几条加起来多少 prefill token”。**

### 3.4 一个更精确的写法

```
TTFT ≈ T_固定 + T_prefill(C × L 或 B)
```

- `T_固定`：调度、采样、框架、网络等，不随 token 数变。
- `T_prefill`：prefill 计算，随同一步 token 数增长。

**短 prompt 时，`T_prefill` 远小于 `T_固定`，TTFT 看起来不变。**
**长 prompt 时，`T_prefill` 是主要部分，TTFT 随 token 数明显增长。**

### 3.5 调 `max-num-batched-tokens` 对 TTFT 的影响

`B` 越大，`C × L ≤ B` 能容纳的并发越高，prompt 被切的概率越低，TTFT 越可控。

**代价**：每一步的 prefill 占用 GPU 更久，如果同时有 decode 请求在跑，它们的 ITL 尖峰会更宽。启动时按这个上限做显存 profile，激活占得更多，KV 容量可能下降。

---

## 四、示例：一个 27B 稠密模型在 48GB 卡上的完整推演

下面用一个具体例子，把上面的概念串起来。示例参数如下，**不是任何一次真实测试的结果，只是用来演示计算方式**。

### 4.1 示例配置

| 项目 | 值 |
|---|---|
| 模型 | 27B 稠密模型，FP8 权重 |
| GPU | 48GB，可见显存 47.36 GiB |
| 显存带宽 | 1008 GB/s |
| `gpu-memory-utilization` | 0.9 |
| `block_size` | 16 |
| `max_num_batched_tokens` | 2048 |
| `max_num_seqs` | 256 |
| `max_model_len` | 20480 |
| KV dtype | FP8 |
| 每 token KV 字节数 | 假设 49 KiB |
| 权重和非 torch | 假设 29.34 GiB |
| 峰值激活 | 假设 2.06 GiB |

### 4.2 显存拆分计算

```
总预算 = 47.36 × 0.9 = 42.63 GiB
KV cache = 42.63 − 29.34 − 2.06 = 11.23 GiB
```

KV token 容量：

```
11.23 GiB / 49 KiB ≈ 239,000 token
```

Block 数量：

```
239,000 / 16 ≈ 14,900 个 block
```

每个 block 字节数：

```
49 KiB × 16 ≈ 784 KiB
```

### 4.3 并发容量计算

| 单条长度 | 放得下 |
|---|---|
| 664（536 输入 + 128 输出） | 239,000 / 664 ≈ 360 路 |
| 2,048 | 239,000 / 2,048 ≈ 117 路 |
| 8,192 | 239,000 / 8,192 ≈ 29 路 |
| 20,480 | 239,000 / 20,480 ≈ 11.7 路 |

### 4.4 TTFT 推演

假设单条 prompt 536 token，prefill 时间函数 `f(n) ≈ n × 0.5 ms`（仅用于演示）。

**并发 1**：

```
C × L = 536 ≤ 2048，一步算完
TTFT ≈ T_固定 + 536 × 0.5 ms = T_固定 + 268 ms
```

**并发 2**：

```
C × L = 1072 ≤ 2048，一步算完
TTFT ≈ T_固定 + 1072 × 0.5 ms = T_固定 + 536 ms
```

TTFT 约为并发 1 的 1.8 倍。

**并发 4**：

```
C × L = 2144 > 2048，被切
prefill 步数 = ceil(2144 / 2048) = 2
TTFT ≈ T_固定 + 2 × f(2048) + 排队
     ≈ T_固定 + 2 × 1024 ms + 排队
     ≈ T_固定 + 2048 ms + 排队
```

第 4 条被切，TTFT 额外增加一步的排队时间。

**并发 8**：

```
C × L = 4288 > 2048
prefill 步数 = ceil(4288 / 2048) = 3
TTFT ≈ T_固定 + 3 × 1024 ms + 排队
```

**并发 16**：

```
C × L = 8576 > 2048
prefill 步数 = ceil(8576 / 2048) = 5
TTFT ≈ T_固定 + 5 × 1024 ms + 排队
```

### 4.5 结论

从这个示例可以看出：

1. **KV 容量决定能放多少路**。本例约 360 路（664 token 请求），但实际远开不到，因为算力先限制。
2. **TTFT 由 `C × L` 和 `B` 决定**。`C × L ≤ B` 时一步算完，TTFT 随 `C × L` 线性增长；`C × L > B` 时被切成多步，TTFT 额外增加排队。
3. **并发 4 是一个转折点**。536 × 4 = 2144 刚好越过 2048，第 4 条被切，TTFT 从“线性增长”变成“多一步排队”。
4. **调大 `B` 可以推迟转折点**。`B = 4096` 时，并发 4 的 `C × L = 2144 < 4096`，四条整步进，TTFT 回到线性增长。
5. **代价是 ITL 尖峰变宽**。`B` 越大，每一步的 prefill 占用 GPU 越久，decode 请求等得越久。

---

## 五、一句话总结

**vLLM 把显存分成权重、激活、KV cache 三块，KV cache 切成 16 token 一个的 block。调度器每一步在 `max_num_batched_tokens`、`max_num_seqs`、`max_model_len`、空闲 block 数四个约束下，优先调度 decode 请求，剩余预算给 prefill。TTFT 由同一步里的 prefill token 总数决定，不是由并发数决定：`C × L ≤ B` 时一步算完，`C × L > B` 时被切成多步，TTFT 额外增加排队。**