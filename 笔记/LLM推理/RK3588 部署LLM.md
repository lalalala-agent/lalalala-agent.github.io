# 02. 大语言模型部署实战：RK3588 上运行 LLM

本文以 Rockchip RK3588 为例，介绍如何将开源大语言模型转换为 RKLLM 格式，并在开发板上运行、测试和评估。

目标是跑通一条完整流程：

**准备模型 → RKLLM 转换与量化 → 板端部署 → 交互测试 → 性能评估**

## 1. 环境与模型准备

### 1.1 部署架构

- **开发机**：下载模型、安装 RKLLM Toolkit、执行模型转换。
- **RK3588 开发板**：安装匹配的 Runtime 和驱动，运行转换后的模型。
- **RKLLM 模型文件**：开发机转换生成的 `.rkllm` 文件。

参考仓库：[airockchip/rknn-llm](https://github.com/airockchip/rknn-llm)。

本文以官方 API Demo 使用的 `DeepSeek-R1-Distill-Qwen-1.5B` 为例。初次实践建议优先选择官方已支持的模型；具体支持情况以所使用的 Toolkit 版本为准。

### 1.2 下载模型

在开发机安装 Hugging Face 下载工具：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -U huggingface_hub
```

下载模型权重：

```bash
hf download deepseek-ai/DeepSeek-R1-Distill-Qwen-1.5B \
  --local-dir ./DeepSeek-R1-Distill-Qwen-1.5B
```

如果无法访问 Hugging Face，可使用符合模型许可要求的其他下载方式。

### 1.3 安装 RKLLM Toolkit

从 [官方仓库](https://github.com/airockchip/rknn-llm) 获取 SDK，选择与 Python 版本、操作系统和目标平台匹配的 Toolkit。

官方示例提供模型转换脚本，要求 Toolkit 与 Runtime 版本匹配。不要混用不同版本的模型转换工具、Runtime 和预编译程序。

## 2. 模型转换与量化

这是整个流程的核心步骤。

### 2.1 获取官方示例

```bash
git clone https://github.com/airockchip/rknn-llm.git
cd rknn-llm/examples/rkllm_api_demo/export
```

官方示例提供两个主要脚本：

- `generate_data_quant.py`：生成量化所需的数据。
- `export_rkllm.py`：加载模型、执行量化与构建，并导出 RKLLM 文件。

### 2.2 生成量化数据

```bash
python generate_data_quant.py \
  -m /absolute/path/to/DeepSeek-R1-Distill-Qwen-1.5B
```

将路径替换为实际模型目录。

### 2.3 导出 RKLLM 模型

先检查 `export_rkllm.py` 中的模型路径、量化配置和输出目录，再执行：

```bash
python export_rkllm.py
```

官方示例的转换脚本会配置目标平台、量化方式、NPU 核心数和上下文长度。初次实践建议先使用官方示例配置，确认模型成功导出后再调整参数。

转换成功后，检查生成文件：

```bash
find . -type f -name "*.rkllm"
```

**预期结果：** 得到一个 `.rkllm` 文件，可用于后续板端推理。

注意：量化可能影响模型回答质量。模型转换成功不代表量化后精度与原始模型完全一致。

## 3. 部署到 RK3588

### 3.1 编译官方 Demo

返回 API Demo 的部署目录：

```bash
cd ../deploy
```

检查 `build-linux.sh` 中的交叉编译器路径，并修改为本机实际安装的 AArch64 工具链，然后执行：

```bash
chmod +x build-linux.sh
./build-linux.sh
```

官方示例会生成 `install/demo_Linux_aarch64` 目录，其中包含 `llm_demo` 和运行所需的库文件。

### 3.2 复制程序与模型

将编译产物和转换后的模型复制到开发板。以下使用 ADB：

```bash
adb push install/demo_Linux_aarch64 /data
adb push /absolute/path/to/model.rkllm \
  /data/demo_Linux_aarch64/
```

将 `model.rkllm` 替换为实际模型文件名。

### 3.3 启动模型

进入开发板终端：

```bash
adb shell
cd /data/demo_Linux_aarch64

export LD_LIBRARY_PATH=./lib
export RKLLM_LOG_LEVEL=1

./llm_demo ./model.rkllm 2048 4096
```

启动参数的具体含义与顺序以当前版本的 Demo 为准；示例中的 `2048` 和 `4096` 是配置示例，不适用于所有模型。

正常情况下，日志会出现类似内容：

```text
rkllm init start
rkllm init success
```

看到初始化成功后，即可进入交互测试。

如果程序无法启动，优先检查模型路径、Runtime 动态库、驱动版本和模型兼容性。

## 4. 交互测试

先测试一个简单的中文问题：

```text
user: 请用三句话介绍 RK3588。
```

检查模型是否能够正常生成中文回答，再测试多轮对话：

```text
user: 什么是 NPU？
assistant: NPU 是面向神经网络计算优化的处理器。

user: 它与 CPU 有什么区别？
```

重点观察：

- 是否正常输出中文。
- 回答是否符合问题要求。
- 多轮对话是否能关联前文。
- 是否出现乱码、重复输出或异常退出。

以上是测试用例，不是实测输出。实际回答会随模型、采样参数和聊天模板变化。

## 5. 性能评估与常见问题

### 5.1 记录关键指标

至少记录以下数据：

| 指标 | 含义 |
|---|---|
| 首 token 延迟（TTFT） | 从提交请求到输出首个 token 的耗时 |
| 生成速度 | 解码阶段平均每秒生成的 token 数 |
| 内存占用 | 模型运行期间的内存使用量 |
| 稳定性 | 多轮或长时间运行是否出现异常 |

在板端启用性能日志：

```bash
export RKLLM_LOG_LEVEL=1
```

可结合官方仓库提供的性能监测脚本查看 CPU 和 NPU 使用情况。不同 Runtime 版本输出的日志字段可能不同。

平均生成速度可按下式计算：

\[
\text{生成速度}=\frac{\text{生成 token 数}}{\text{生成阶段耗时（秒）}}
\]

测试时应保持模型、上下文长度、电源和散热条件一致，并区分首 token 延迟与后续 token 的生成速度。不要将未经实测的数字写入性能结果。

### 5.2 故障速查

| 问题 | 优先检查 |
|---|---|
| 模型无法加载 | 模型路径、Toolkit 与 Runtime 版本、驱动兼容性 |
| 内存不足 | 模型规模、上下文长度、系统可用内存 |
| 生成速度偏低 | 输入长度、温度、频率、电源与 NPU 使用情况 |
| 回答乱码 | tokenizer、聊天模板及模型转换配置 |
| 缺少动态库 | `LD_LIBRARY_PATH` 和对应 Runtime 库文件 |

## 6. VLM 部署简介

VLM（视觉语言模型）在文本模型之外增加了图像理解能力。RK3588 上的典型部署流程是：

```text
输入图片
   ↓
视觉编码器（RKNN）
   ↓
视觉特征
   ↓
语言模型（RKLLM）
   ↓
文本回答
```

建议先完成纯文本 LLM 部署，再尝试官方多模态示例：

[RKLLM Multimodal Model Demo](https://github.com/airockchip/rknn-llm/tree/main/examples/multimodal_model_demo)

官方仓库也提供预转换模型及 Demo 的快速运行说明，可先用现成模型验证整条多模态推理链路，再研究视觉模型与语言模型的转换过程。

## 参考资料

- [RKLLM 官方仓库与 SDK](https://github.com/airockchip/rknn-llm)
- [RKLLM API Demo：模型转换与板端推理](https://github.com/airockchip/rknn-llm/tree/main/examples/rkllm_api_demo)
- [RKLLM 多模态 Demo](https://github.com/airockchip/rknn-llm/tree/main/examples/multimodal_model_demo)

