# 端侧部署
**暂不单开**：语音（SenseVoice 与 Matcha）——没有和语言模型同板的时延与内存实测。图像每次重编码、历史只留一轮，写在端侧性能篇里。

## 成稿

| 文档 | 内容 |
| --- | --- |
| [vLLM 的显存、Block 与并发调度](<vLLM 的显存、Block 与并发调度.md>) | 显存如何拆成权重、激活和 KV block，并发上限由哪一块决定 |
| [KV Cache 与 Prefix Caching 的调度流程](<KV Cache 与 Prefix Caching 的调度流程.md>) | 键值缓存为什么必须有，前缀缓存如何进入调度 |
| [Prefix Caching](<Prefix Caching.md>) | 多条请求共享同一段系统提示词时，命中怎么算 |
| [Qwen3.8-27B并发压测报告](Qwen3.8-27B并发压测报告.md) | 4090 上 Qwen3.8-27B-FP8 的服务参数和并发压测 |
| [RK3588硬件](RK3588硬件.md) | 大小核、三核 NPU、锁频，以及共享内存为什么是硬边界 |
| [RK3588模型打包](RK3588模型打包.md) | 语言模型收成 rkllm、视觉编码器收成 rknn，纯文本与图文怎么加载 |
| [Qwen3-VL端侧性能](Qwen3-VL端侧性能.md) | 2B 在 RK3588 上的首 token、解码速度和峰值内存 |
