# LangGraph 多节点与 custom 流式

几个节点串成一张图，模型每吐出一个片段就立刻交给调用方。不绑定业务，不需要真实 API key。

依赖：`langgraph>=0.6`。

## 核心概念

`astream` 的 `stream_mode` 决定你收到什么：

| mode | 得到的内容 |
|------|------------|
| `updates` | 每个节点返回的状态增量 |
| `messages` | 图里 LangChain 消息对象的 token |
| `custom` | 节点里自己 `writer(...)` 的对象 |

业务要的是自己定的事件，而不是框架的状态 diff。做法是：**节点里取 writer 往外写，调用方用 `stream_mode="custom"` 接。**

```python
writer = get_stream_writer()
writer({"event": "chunk", "text": piece})
```

约定：

- `writer` 的参数会被原样 yield，事件结构自己定。
- `get_stream_writer()` 只在某次 `astream` / `astream_events` 正在执行的节点里有效，图外调用会抛错。

## 状态与节点

状态用 `TypedDict`。节点只返回要合并的字段，不改传入的 dict。

```python
class State(TypedDict, total=False):
    user_input: str
    reply: str
```

典型线性图：

```text
START → start → reply → END
```

- `start`：空节点，正式服务里用来灌记忆。
- `reply`：边生成边 `writer`，并把全文放进 `reply`。

## 通用流式节点模板

任何「边生成边推送」的节点都可以套这个形状：

```python
async def streaming_node(state: State) -> dict:
    writer = get_stream_writer()
    parts: list[str] = []
    async for piece in generate(state):        # 你的模型 / 子流程
        parts.append(piece)
        writer({"event": "chunk", "text": piece})
    return {"reply": "".join(parts)}
```

要点：

- `writer` 在节点内取，不要在节点外取。
- 累积全文放回状态，流式只负责「即时可见」。

## 子图的 chunk 不会自动冒泡

节点内部再 `compile` 一张子图并自己 `astream` 时：

- 子图的 custom 事件进的是这次子调用，**不会**出现在父图的 `astream` 里。
- 子图的状态增量也**不会**自动写回父状态。

父节点要做的只有三件事：

```python
writer = get_stream_writer()                     # 1. 进子图前先取父 writer
async for chunk in child.astream(state, stream_mode="custom"):
    writer(chunk)                                # 2. 逐条转发
return {...}                                     # 3. 需要回父状态就自己 return
```

## 最小可运行骨架

```python
import asyncio
from typing import AsyncIterator, TypedDict

from langgraph.config import get_stream_writer
from langgraph.graph import END, START, StateGraph


class State(TypedDict, total=False):
    user_input: str
    reply: str


async def fake_llm(text: str) -> AsyncIterator[str]:
    for piece in (text or "你好", "，", "这是流式回复。"):
        await asyncio.sleep(0.02)
        yield piece


async def start_node(state: State) -> dict:
    return {}


async def reply_node(state: State) -> dict:
    writer = get_stream_writer()
    parts: list[str] = []
    async for piece in fake_llm(state.get("user_input") or ""):
        parts.append(piece)
        writer({"event": "chunk", "text": piece})
    return {"reply": "".join(parts)}


def build():
    g = StateGraph(State)
    g.add_node("start", start_node)
    g.add_node("reply", reply_node)
    g.add_edge(START, "start")
    g.add_edge("start", "reply")
    g.add_edge("reply", END)
    return g.compile()


async def main():
    graph = build()
    async for event in graph.astream({"user_input": "今天天气"}, stream_mode="custom"):
        print(event)


asyncio.run(main())
```

## 常用变体

- **同时看状态增量**：`stream_mode=["custom", "updates"]`，每条变成 `(mode, data)` 二元组。
- **子图**：父节点按上面的「取 writer → 转发 → return」处理，不要指望自动冒泡。

