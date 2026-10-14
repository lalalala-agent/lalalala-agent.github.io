# FastAPI + LangGraph：多流程、多机器人、多用户

一台服务同时接多台机器人、多种对话流程、多个用户。它们共用同一套外壳，区别只在于注册进去的图不同。

图内部怎么设计，见 [LangGraph规划和执行.md](./LangGraph规划和执行.md)。

## 三个概念要分开

| 概念 | 用什么标识 | 生命周期 | 放什么 |
|------|-----------|----------|--------|
| 流程 | 类型名 | 服务启动时编译一次，所有机器人共用 | 节点和边。不包含「当前用户」 |
| 机器人 | 机器人 id | 一次连接期间一条 | WebSocket、类型、当前用户、输入队列、串行锁 |
| 用户 | 用户 id | 挂在某台机器人的连接上 | 这一轮是谁在说话。换人只改这个字段 |

图是模板，本身不保存对话状态。每轮对话把机器人 id、用户 id、用户原话放进当次状态再跑。记忆按「机器人 + 用户」去取，不写进图对象。人设（角色、口吻）和图分开保存，连接建立时抄到连接上，每轮放进 `state["profile"]`，改说法不用重新编译图。

## 一条连接上的两个循环

- **收包循环**：读 WebSocket。控制消息立刻处理，用户原话只放进队列。
- **对话循环**：从队列取话，按类型取图，跑完一轮再取下一条。

模型调用放在对话循环里。收包循环一旦等模型，心跳和后到的包都会停住。同一条连接的流式回复加一把锁，避免两段话交错；不同机器人各有自己的锁。

```python
async def recv_loop(conn):
    while True:
        msg = await conn.ws.receive_json()
        if msg["event"] == "user_input":
            conn.queue.put_nowait(msg)
        else:
            await handle_control(conn, msg)


async def dialogue_loop(conn, workflows):
    while True:
        msg = await conn.queue.get()
        graph = workflows.get(conn.robot_type) or workflows["chat"]
        state = {
            "robot_id": conn.robot_id,
            "user_id": conn.user_id,
            "user_input": msg["text"],
            "profile": conn.profile,
        }
        await stream_turn(conn, graph, state)
```

## 启动时编译一次

类型名对应一个构建函数，未知类型退回默认对话。服务启动时把所有已注册类型编译进表，请求路径只查表，不重新编译。

```python
BUILDERS: dict[str, Callable] = {}

def register(robot_type: str):
    def decorator(fn):
        BUILDERS[robot_type] = fn
        return fn
    return decorator

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.workflows = {name: fn() for name, fn in BUILDERS.items()}
    yield
```

## 连接对象

一台机器人一条连接，键是机器人 id。连接上记着类型、当前用户、套接字、队列和锁。换人只改 `user_id`。

```python
class Connection:
    def __init__(self, robot_id: str):
        self.robot_id = robot_id
        self.robot_type = "chat"
        self.user_id = "anonymous"
        self.profile: dict = {}
        self.ws = None
        self.lock = asyncio.Lock()
        self.queue: asyncio.Queue = asyncio.Queue(maxsize=8)
```

## 对外协议：开始、片段、结束

客户端注册时带上类型名，用来选已编译的图。一轮回复固定三段，片段就是节点写出的 custom 事件，外层原样转发。

```python
async def stream_turn(conn, graph, state):
    async with conn.lock:
        msg_id = new_id()
        await send(conn, {"event": "start", "msg_id": msg_id})
        async for chunk in graph.astream(state, stream_mode="custom"):
            await send(conn, chunk)
        await send(conn, {"event": "end", "msg_id": msg_id})
```

## 扩展方式

外壳不动，新类型只在下面两种改法里选。

**换人设。** 流程和能力表不变，只换人设，或只替换某个入口节点。

```python
@register("chat")
def build_chat_graph():
    return build_chat(greet_node=default_greet)

@register("tour")
def build_tour_graph():
    return build_chat(greet_node=tour_greet)
```

**换计划和能力表。** 仍走同一条外层管道，计划和能力表换成自己的。

```python
def build_recommend(*, vision_node):
    agent_map = {
        "product": product_node,
        "chat": chat_node,
        "search": search_node,
        "vision": vision_node,
        "end": end_node,
    }
    allowed = {"product", "chat", "search", "vision"}
    return compile_once(
        plan_node=recommend_plan_node,
        agent_map=agent_map,
        allowed=allowed,
        fallback=[{"step": ["chat"]}],
    )
```

加一种机器人时改三处：构建函数、`@register("类型名")`、一份人设。客户端注册时带上这个类型名。连接、队列、`stream_turn` 保持原样。

## 模块划分

```text
app/
  main.py              # 启动时编译全部已注册的图
  profiles.py          # 类型 → 人设
  connections.py       # 机器人 id → Connection
  routers/chat.py      # 收包循环与对话循环
  graphs/registry.py   # register、compile_once、compile_loop、parse_plan
  graphs/chat.py       # 日常聊天；导览复用它并替换问候
  graphs/recommend.py  # 推荐：自己的 plan 与能力表
```

`routers/chat.py` 只做三步：`get_connection` → 按 `robot_type` 取图 → `stream_turn`。业务分支留在 `graphs/` 里。

---
