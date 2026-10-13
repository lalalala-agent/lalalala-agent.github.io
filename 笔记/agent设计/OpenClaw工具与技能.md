# 工具与技能

> 面向开源开发者的技术文档。描述 Agent 框架如何把「模型能做什么」和「模型该怎么做」分开设计。

---

## 一、总览

模型不碰磁盘、不发网络包、不驱动设备。它在一轮里只能做两件事：

- 给出文字
- 点名一个宿主已经允许的动作

动作分两类：

| 类别 | 是什么 | 谁执行 |
| --- | --- | --- |
| **工具** | 宿主立刻能执行的能力 | 宿主校验参数、执行、把短结果送回模型 |
| **技能** | 教模型何时、按什么步骤去使用这些工具的说明 | 模型自己读、自己判断时机 |

**关键理解：技能不是另一个进程，也不是一套新的插件运行时。** 它只是一份 Markdown 说明文件，模型在需要时读它，然后调用已经存在的工具。

---

## 二、工具

### 2.1 两种工具来源

| 来源 | 定义方 | 格式 |
| --- | --- | --- |
| **本地工具** | 运行时自带 | 运行时内部格式（Zod schema 等） |
| **MCP 工具** | 外部 MCP 服务器 | MCP 协议规定的 JSON 格式 |

两条路的共同点：模型只发起调用请求，宿主校验、执行、把短结果送回。

### 2.2 MCP 工具定义格式

MCP（Model Context Protocol）是一个开放协议，标准化了应用如何向 LLM 提供工具。

**核心字段：**

```json
{
  "name": "get_weather",
  "description": "Get the current weather in a given location",
  "inputSchema": {
    "type": "object",
    "properties": {
      "location": {
        "type": "string",
        "description": "City name or zip code"
      }
    },
    "required": ["location"]
  }
}
```

| 字段 | 必需 | 说明 |
| --- | --- | --- |
| `name` | 是 | 唯一标识，建议 1-128 字符，如 `get_weather`、`DATA_EXPORT_v2`、`admin.tools.list` |
| `title` | 否 | 人类可读的显示名 |
| `description` | 是 | 功能的文字说明，模型据此判断何时使用 |
| `inputSchema` | 是 | JSON Schema，定义参数结构 |
| `outputSchema` | 否 | JSON Schema，定义输出结构 |
| `annotations` | 否 | 工具行为的元数据（只读、破坏性等） |

**一个带枚举参数和输出 schema 的完整示例：**

```json
{
  "name": "get_weather_data",
  "description": "Weather Data Retriever. Get current weather data for a location.",
  "inputSchema": {
    "type": "object",
    "properties": {
      "location": { "type": "string", "description": "City name or zip code" },
      "unit": { "type": "string", "enum": ["celsius", "fahrenheit"] }
    },
    "required": ["location"]
  },
  "outputSchema": {
    "type": "object",
    "properties": {
      "temperature": { "type": "number" },
      "conditions": { "type": "string" },
      "humidity": { "type": "number" }
    },
    "required": ["temperature", "conditions", "humidity"]
  }
}
```

**协议操作：**

| 方法 | 用途 | 返回 |
| --- | --- | --- |
| `tools/list` | 发现可用工具 | 工具定义数组 |
| `tools/call` | 执行特定工具 | 工具执行结果 |

**调用与返回：**

```
模型 → tool_use { name: "get_weather", input: { location: "Tokyo" } }
宿主 → 执行 → tool_result { content: "22.5, Partly cloudy" }
模型 → 基于结果继续
```

### 2.3 本地工具定义格式

运行时自带的工具，通常用**代码里的类型系统**定义，再自动转成模型能看的 JSON Schema。

**以 Zod 为例（Claude Code 内部做法）：**

```typescript
// src/Tool.ts
const BashTool = {
  name: "Bash",
  inputSchema: z.object({
    command: z.string().describe("The command to execute"),
    timeout: z.number().optional().describe("Milliseconds. Default 120000, max 600000"),
    run_in_background: z.boolean().optional()
  }),
  // ...
}
```

**本地工具常用示例（格式参考）：**

**Read 工具**
```json
{
  "name": "Read",
  "description": "Reads a file from the local filesystem. Supports text, images, PDF, Jupyter Notebook.",
  "input_schema": {
    "type": "object",
    "properties": {
      "file_path": {
        "type": "string",
        "description": "The absolute path to the file to read"
      },
      "offset": {
        "type": "number",
        "description": "The line number to start reading from"
      },
      "limit": {
        "type": "number",
        "description": "The number of lines to read"
      },
      "pages": {
        "type": "string",
        "description": "Page range for PDF files (e.g., '1-5', '3', '10-20'). Max 20 pages/request."
      }
    },
    "required": ["file_path"]
  }
}
```
路径必须是绝对路径；默认读取前 2000 行；PDF 超过 10 页必须指定 `pages`；可并行读取多个文件。

**Bash 工具**
```json
{
  "name": "Bash",
  "description": "Executes a given bash command in a persistent shell session with optional timeout.",
  "input_schema": {
    "type": "object",
    "properties": {
      "command": {
        "type": "string",
        "description": "The command to execute"
      },
      "timeout": {
        "type": "number",
        "description": "Milliseconds. Foreground: capped at 600000 by default, higher values are clamped."
      },
      "run_in_background": {
        "type": "boolean",
        "description": "Set to true to run command in background"
      }
    },
    "required": ["command"]
  }
}
```
默认超时 120 秒，最大 600 秒；输出超过 30,000 字符会被截断；禁止使用交互式标志（如 `-i`）。

### 2.4 工具描述的最佳实践

**描述是工具性能最重要的因素。** 应包含：

- 工具做什么
- 何时使用（何时不使用）
- 每个参数的含义和影响
- 重要的限制或注意事项

**好的描述示例**（Anthropic 推荐）：
> “获取给定股票代码的当前价格。股票代码必须是美国主要交易所公开交易公司的有效代码。该工具将返回以美元计的最新交易价格。当用户询问某只股票的当前或最新价格时应使用。它不提供关于股票或公司的其他信息。”

**不好的描述**：只写“获取股票代码的价格”，信息量不足。

### 2.5 工具名单与延迟加载

**名单在一轮开始时固定，模型不能在对话中安装新工具。**

当 MCP 工具很多时，全部加载会占用大量上下文。Claude Code 的做法是**延迟加载**：只加载工具名称和服务器说明，完整 schema 在模型需要时才加载。

| 策略 | 说明 |
| --- | --- |
| **默认（tool search 开启）** | MCP 工具推迟加载，按需发现 |
| **`alwaysLoad: true`** | 该服务器的所有工具在会话启动时加载 |
| **阈值模式（`auto`）** | 工具定义总量低于上下文窗口 10% 时预加载，达到后推迟 |

---

## 三、技能

### 3.1 为什么需要技能

工具说明怎么用，往往比工具本身更长。如果把每个技能的步骤都放进系统提示词：

- 每一轮都在重复发送用不上的规程
- 模型也更容易拿错步骤

### 3.2 一份技能是什么

一份技能是一个**目录**，至少有一份 `SKILL.md`：

```
skills/
└── video-intro/
    ├── SKILL.md          ← 名称、适用时机、步骤、示例
    ├── reference.md      ← 详细参考（按需加载）
    ├── scripts/
    │   └── make_intro.py ← 可以调用的脚本
    └── assets/
        └── template.png
```

**SKILL.md 的结构：**

```markdown
---
name: video-intro
description: 做自我介绍视频时使用。当用户说「做一支自我介绍的视频」「生成个人介绍视频」时触发。
---

# Video Intro

## 何时使用
当用户需要制作自我介绍视频时使用。

## 步骤
1. 收集用户信息（姓名、职位、爱好）
2. 调用 scripts/make_intro.py 生成视频
3. 确认输出并发送给用户

## 示例
用户说：「帮我做一支自我介绍的视频」
→ 询问姓名和职位
→ 运行脚本生成
→ 发送视频文件

## 可以调用的脚本
- scripts/make_intro.py
```

**`name` 和 `description` 是必需字段。** `description` 决定模型何时自动加载这个技能。

### 3.3 运行时怎么做

运行时在一轮开始时**只把名称和适用时机放进上下文**，并写明：

> 判断用得上时，再用读文件的工具去读正文和同目录的其他文件。

```pseudo
# 系统提示词里的技能索引（简短）
## 可用技能
- video-intro：做自我介绍视频时使用
- email-draft：起草邮件时使用
- data-report：生成数据报告时使用

判断用得上时，用 Read 工具读取对应的 SKILL.md 正文。
```

**技能列表只注入元数据，完整指令按需加载。**

### 3.4 模型的路径

```
1. 从索引里看出「做某件事」有一份技能
        ↓
2. 读那份说明（Read 工具）
        ↓
3. 按说明调用已经存在的工具
```

### 3.5 技能目录的位置

**技能目录必须在这一轮的工作目录下面**，否则模型看不见索引。

常见的发现层级：

| 优先级 | 位置 | 可见范围 |
| --- | --- | --- |
| 最高 | `<workspace>/skills/` | 仅当前工作区 |
| 中 | `<workspace>/.agents/skills/` | 当前工作区的智能体 |
| 低 | `~/.agents/skills/` | 本机所有智能体 |
| 最低 | 内置技能 | 随运行时提供 |

### 3.6 技能里需要本地程序时

正文写明调用工作区里的哪个脚本，由命令工具执行。**不在技能里再启动一个长期服务，也不把技能做成需要单独安装的插件。**

---

## 四、领域技能

### 4.1 是什么

有些能力比一份说明更重：点单、迎宾、按资料回答问题，都需要**专用的处理步骤**和**一大份资料**。这种技能注册成一组专用节点，外加一份可检索的资料库。

### 4.2 资料怎么用

- 资料按**条目**存放，并有一份**索引**
- 节点在本轮问题到来时**检索**
- 只把**命中的条目**放进这个节点的提示
- **手册全文不进入系统提示词，也不进入其他节点**

### 4.3 两种技能对比

| 维度 | 普通技能 | 领域技能 |
| --- | --- | --- |
| **检索执行者** | 模型自己读说明 | 节点内部，由运行时完成 |
| **资料形态** | 说明文件 | 条目化资料库 + 索引 |
| **模型职责** | 判断时机、读正文、调工具 | 决定怎么说、怎么用条目，不负责翻完整本手册 |

---

## 五、权限

工具让模型能够改文件、跑命令、对用户发消息。**边界要放在宿主，不能放在提示词的劝告里。**

| 边界 | 规则 |
| --- | --- |
| **触发权** | 只有有权的人能触发一轮工作：个人助手里是主人；接待设备上是已登记的那条连接 |
| **工作区** | 命令和文件限制在这块磁盘上的工作目录，技能索引也从这里发现 |
| **名单** | 允许名单之外的工具调用直接拒绝 |
| **投递** | 模型调发消息工具只表示「请把这段文字发给本轮所属的会话」，指定不了另一个通道的内部对象 |
| **场景** | 共享场合不加载只属于某一个人的技能资料 |

> 提示词可以提醒模型谨慎使用命令。**真正挡住越权的是名单、目录和工作区，不是提醒本身。**

---

## 六、核心原则总结

| 原则 | 说明 |
| --- | --- |
| **模型只点名，宿主执行** | 模型不碰磁盘、不发网络包、不驱动设备 |
| **结果要短** | 成功/失败、关键标识、下一步需要的几行；完整日志留宿主侧 |
| **描述是工具性能的核心** | 清晰说明做什么、何时用、参数含义、限制 |
| **名单一轮固定** | 模型不能在对话中安装新工具；新能力先在宿主实现 |
| **MCP 工具用 JSON Schema** | `name`、`description`、`inputSchema` 三件套 |
| **本地工具用类型系统** | Zod 等 schema，自动转 JSON Schema 给模型 |
| **技能是说明，不是进程** | 技能文件教模型何时、按什么步骤用工具 |
| **索引在提示，正文按需读** | 开场只放名称和适用时机，用时再读 SKILL.md |
| **领域技能 = 节点 + 资料库** | 资料条目化，节点检索，只把命中条目放进提示 |
| **边界在宿主** | 触发权、工作区、名单、投递、场景，由宿主挡 |

---

## 七、一句话总结

> 模型一轮里只能做两件事：给出文字，或点名一个宿主已允许的动作。**MCP 工具**用 JSON 格式定义，核心是 `name`、`description`、`inputSchema`；**本地工具**用代码里的类型系统定义，自动转成 JSON Schema。**技能**是 Markdown 说明文件，开场只放名称和适用时机，用时再读正文。**权限边界放在宿主**——允许名单、工作目录、投递目标，真正挡住越权的是这些。