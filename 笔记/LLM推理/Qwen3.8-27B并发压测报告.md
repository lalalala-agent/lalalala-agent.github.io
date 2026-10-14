# Qwen3.8-27B-FP8 并发压测报告

## 一、测试环境


| 项目    | 值                                          |
| ----- | ------------------------------------------ |
| CPU   | Intel Core i9-14900K，24 核 32 线程            |
| 内存    | 62.5 GiB                                   |
| GPU   | NVIDIA GeForce RTX 4090，49140 MiB，计算能力 8.9 |
| 模型    | Qwen/Qwen3.8-27B-FP8，对外名称 Qwen3.8-27B-FP8  |
| 量化    | FP8 权重                                     |
| 推理框架  | vLLM 0.31.0，Rust frontend                  |
| 原生上下文 | 262144                                     |
| 服务上下文 | 20480                                      |


## 二、服务参数

```bash
vllm serve "$PWD/Qwen/Qwen3.8-27B-FP8" \
  --served-model-name Qwen3.8-27B-FP8 \
  --host 0.0.0.0 \
  --port 8000 \
  --max-model-len 20480 \
  --kv-cache-dtype fp8 \
  --enforce-eager \
  --tensor-parallel-size 1 \
  --gpu-memory-utilization 0.9 \
  --enable-auto-tool-choice \
  --tool-call-parser qwen3_coder \
  --reasoning-parser qwen3 \
  --mm-encoder-tp-mode data
```


| 参数                          | 值           | 含义                            |
| --------------------------- | ----------- | ----------------------------- |
| `--max-model-len`           | 20480       | 单条请求输入加输出的上限                  |
| `--kv-cache-dtype`          | fp8         | KV 用 FP8 存                    |
| `--enforce-eager`           | 开启          | 关闭 CUDA Graph 和 torch.compile |
| `--tensor-parallel-size`    | 1           | 单卡                            |
| `--gpu-memory-utilization`  | 0.9         | 本进程最多占用可见显存的比例                |
| `--enable-auto-tool-choice` | 开启          | 工具调用解析为 OpenAI tool_calls     |
| `--tool-call-parser`        | qwen3_coder | Qwen3 Coder 工具调用格式            |
| `--reasoning-parser`        | qwen3       | 思考内容拆到 reasoning_content      |
| `--mm-encoder-tp-mode`      | data        | 视觉编码器按数据并行切 batch             |


调度默认值：`--max-num-seqs` 默认 256，`--max-num-batched-tokens` 默认 2048。prefix caching 默认开启。

## 三、显存拆分

vLLM 可见显存 47.36 GiB，`gpu-memory-utilization 0.9` 预算 42.63 GiB。


| 占用         | 大小                        |
| ---------- | ------------------------- |
| 利用率预算      | 42.63 GiB                 |
| 权重和非 torch | 29.34 GiB                 |
| 峰值激活       | 2.06 GiB                  |
| CUDA Graph | 0                         |
| KV cache   | 11.22 GiB / 239,616 token |
| 合计         | 42.62 GiB                 |


KV cache 容量对应 `Maximum concurrency for 20,480 tokens per request: 11.70x`。

## 四、压测方法


| 参数                | 值                         |
| ----------------- | ------------------------- |
| 工具                | `vllm bench serve`        |
| backend           | `openai-chat`             |
| endpoint          | `/v1/chat/completions`    |
| model             | `Qwen3.8-27B-FP8`         |
| tokenizer         | 本地 `Qwen/Qwen3.8-27B-FP8` |
| num-prompts       | 16 / 档                    |
| random-input-len  | 512                       |
| random-output-len | 128                       |
| request-rate      | inf                       |
| max-concurrency   | 1 / 2 / 4 / 8 / 16        |


对齐后平均输入 536 token，输出固定 128 token。前缀随机、不重复，prefix cache 未命中。

## 五、吞吐

系统输出吞吐（tok/s）：


| 并发     | 1     | 2     | 4     | 8      | 16     |
| ------ | ----- | ----- | ----- | ------ | ------ |
| 平均输出吞吐 | 27.96 | 50.69 | 91.62 | 155.80 | 232.78 |


单请求首字后出字速度（tok/s）：


| 并发    | 1    | 2    | 4    | 8    | 16   |
| ----- | ---- | ---- | ---- | ---- | ---- |
| 单请求解码 | 29.4 | 27.6 | 27.0 | 24.7 | 20.5 |


吞吐明细：


| 并发  | 墙钟 (s) | 请求 (req/s) | 输出 (tok/s) | 峰值输出 (tok/s) | 总吞吐 (tok/s) | 相对单路 | 线性效率  |
| --- | ------ | ---------- | ---------- | ------------ | ----------- | ---- | ----- |
| 1   | 73.26  | 0.22       | 27.96      | 31           | 144.98      | 1.0× | 100%  |
| 2   | 40.40  | 0.40       | 50.69      | 56           | 262.89      | 1.8× | 90.7% |
| 4   | 22.35  | 0.72       | 91.62      | 108          | 475.12      | 3.3× | 81.9% |
| 8   | 13.15  | 1.22       | 155.80     | 216          | 807.97      | 5.6× | 69.7% |
| 16  | 8.80   | 1.82       | 232.78     | 400          | 1,207.19    | 8.3× | 52.0% |


线性效率 = 该档输出吞吐 /（27.96 × 并发）。

## 六、延迟


| 并发  | 平均 TTFT | 中位 TTFT | P99 TTFT | 平均 TPOT  | 中位 ITL  | P99 ITL | 单条端到端  |
| --- | ------- | ------- | -------- | -------- | ------- | ------- | ------ |
| 1   | 264 ms  | 261 ms  | 370 ms   | 33.97 ms | 34.1 ms | 35.0 ms | 4.58 s |
| 2   | 456 ms  | 445 ms  | 513 ms   | 36.17 ms | 36.1 ms | 36.5 ms | 5.05 s |
| 4   | 879 ms  | 879 ms  | 952 ms   | 37.08 ms | 37.0 ms | 37.3 ms | 5.59 s |
| 8   | 1.42 s  | 1.44 s  | 1.87 s   | 40.45 ms | 37.8 ms | 99 ms   | 6.55 s |
| 16  | 2.54 s  | 2.75 s  | 3.61 s   | 48.77 ms | 41.2 ms | 649 ms  | 8.73 s |


单条端到端 ≈ 平均 TTFT + 127 × 平均 TPOT。

## 七、并发容量

KV cache 能放 239,616 token。一条请求占多少 token，就能放多少条：

| 一条请求长度 | 能放几条 |
|---|---|
| 664 | 361 |
| 2,048 | 117 |
| 8,192 | 29 |
| 20,480 | 11.7 |

算式：239,616 ÷ 单条长度。

这次每条请求 664 token，显存能放 361 条。但实测只跑到 16 条，速度就已经不行了——系统 232.78 tok/s，单请求掉到 20.5 tok/s，首字要等 2.54 秒。

也就是说，**还没到显存不够，算力和 prefill 调度就先扛不住了。**

所以优化别往省显存、加 KV 容量上使劲，要往这两个方向：

- **算力**：4090 的 FP8 不是原生矩阵乘，走 Marlin weight-only FP8，单路只有 28 tok/s；`--enforce-eager` 又关了 CUDA Graph 和 torch.compile，发射开销没藏住。
- **prefill 调度**：`--max-num-batched-tokens 2048` 太小。并发 4 时四条合计 2144 token，超了 2048，第 4 条被切成两段，首字从 456 ms 涨到 879 ms。调大这个值比加 KV 容量更管用。

显存只在单条接近 20480 token 时才重新变成问题。这次 512 token，离得很远。

## 八、关键结论

1. 并发 1 时单路输出 28 tok/s，系统输出 27.96 tok/s，单请求解码 29.4 tok/s，三者接近，单路无排队。
2. 并发 16 时系统输出 232.78 tok/s，线性效率 52.0%，单请求解码降至 20.5 tok/s。
3. 并发 1 到 4，TTFT 从 264 ms 增至 879 ms，仍在 1 秒内；并发 8 增至 1.42 s；并发 16 增至 2.54 s。
4. 并发 16 时 P99 ITL 达 649 ms，prefill 切片明显插入 decode。
5. `--max-num-batched-tokens 2048` 在并发 4 时已开始限制：四条合计约 2144 token，略超预算，第 4 条被切。
6. `--gpu-memory-utilization` 从 0.85 调到 0.9，短请求吞吐未变，KV cache 从 188,416 token 增至 239,616 token。多出的显存进入 KV 容量，不改变出字速度。
7. 4090 上 FP8 非原生矩阵乘，走 Marlin weight-only FP8，叠加 `--enforce-eager`，单路输出约 28 tok/s。
8. 显存不是瓶颈：单条 664 token 按显存可放 361 路，实际并发 16 时线性效率已只剩 52.0%，限制在算力和 prefill 调度，不在 KV 容量。
9. 交互场景要求首字 1 秒内，本次 512 token 负载应停在并发 4 左右。并发 16 适合离线批处理。



## 九、待补测

- `--max-num-batched-tokens` 2048 / 4096 / 8192 对比
- profiler：GPU 空闲占比、每步实际 token 数、kernel 算力、kernel 间空隙
- roofline：算力上限、带宽上限、分阶段上限
- 开环泊松到达扫描：饱和吞吐、TTFT p99 容量
- FP8 输出质量 A/B

