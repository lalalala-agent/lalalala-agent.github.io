建议拆成两篇，边界清晰、各自独立可读：

| 篇 | 建议文件名 | 内容 |
|---|---|---|
| 第一篇 | `fastapi-langgraph-multi-robot.md` | 外壳设计：多流程、多机器人、多用户怎么分开，怎么收发消息，怎么扩展 |
| 第二篇 | `langgraph-planning-patterns.md` | 图的内部形态：一次性规划、agent loop、混合，各自适用场景与骨架 |

第一篇偏「服务架构」，第二篇偏「图的设计模式」。两篇互相引用即可，不必重复内容。

---

# 第一篇：`fastapi-langgraph-multi-robot.md`

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

# 第二篇：`langgraph-planning-patterns.md`

# LangGraph 规划与执行的三种形态

同样一张图，内部可以有不同的「决定下一步做什么」的方式。本文讲三种常见形态，以及各自适合什么场景。

它们都能套进 [LangGraph+FastAPI多机器人设计.md](./LangGraph+FastAPI多机器人设计.md) 的外壳：外壳只认「按类型取图 → `astream` 转发」，图内部是哪种形态，外壳不关心。

## 形态一：一次性规划

### 适用场景

步骤固定、能提前枚举的任务。比如客服回答退货：套路永远是「先查规则，再解释」。用户问退货、换货、退款，都是这个流程。提前定好，路径可预测，也好校验。

**用户说**：「我要退货，怎么寄回去？」

**机器人怎么做**：

1. 看一眼问题，定好计划：先查规则，再解释。
2. 照着执行：调 `search` 拿到规则，再调 `chat` 讲成人话。
3. 结束。

### 计划用 JSON 表示

计划不再用自定义字符串，而是一个 JSON 结构：

```json
[
  {"step": ["search"]},
  {"step": ["chat"]}
]
```

外层是数组，表示顺序执行的步骤；每个步骤里的 `step` 是数组，表示这一步要并行执行的动作。上例意思是：先 `search`，再 `chat`。

要并行，就往同一个 `step` 里放多个名字：

```json
[
  {"step": ["search", "fetch_price"]},
  {"step": ["chat"]}
]
```

意思是：先同时 `search` 和 `fetch_price`，两个都完成后再 `chat`。

`plan` 节点直接产出这个结构，`agents` 节点读它、组子图。

### 骨架

```text
START → plan → agents → END
```

```python
def compile_once(*, plan_node, agent_map, allowed, fallback):
    async def agents_node(state):
        writer = get_stream_writer()
        steps = parse_plan(state.get("plan"), allowed, fallback)
        sub = StateGraph(State)
        for name, node in agent_map.items():
            sub.add_node(name, node)
        for name in steps[0]:
            sub.add_edge(START, name)
        for prev_step, curr_step in zip(steps, steps[1:]):
            for prev in prev_step:
                for curr in curr_step:
                    sub.add_edge(prev, curr)
        for name in steps[-1]:
            sub.add_edge(name, END)
        async for chunk in sub.compile().astream(state, stream_mode="custom"):
            writer(chunk)
        return {}

    graph = StateGraph(State)
    graph.add_node("plan", plan_node)
    graph.add_node("agents", agents_node)
    graph.add_edge(START, "plan")
    graph.add_edge("plan", "agents")
    graph.add_edge("agents", END)
    return graph.compile()
```

`plan` 节点返回的 `plan` 字段直接是 JSON 结构：

```python
async def plan_node(state):
    # 实际项目里由模型产出；这里给一个固定示例
    return {"plan": [{"step": ["search"]}, {"step": ["chat"]}]}
```

### 解析与校验

`parse_plan` 只做两件事：把计划归一成 `list[list[str]]`，再做白名单校验。不在白名单里就退回 `fallback`。

```python
def parse_plan(plan, allowed, fallback):
    """把 JSON 计划归一成 list[list[str]]：外层顺序，内层并行。"""
    def normalize(raw):
        if not isinstance(raw, list):
            return []
        steps = []
        for item in raw:
            if isinstance(item, dict):
                names = item.get("step")
            else:
                names = item
            if isinstance(names, str):
                names = [names]
            if isinstance(names, list):
                clean = [n for n in names if isinstance(n, str) and n.strip()]
                if clean:
                    steps.append(clean)
        return steps

    steps = normalize(plan)
    names = {name for step in steps for name in step}
    if not steps or not names <= allowed:
        return normalize(fallback)
    return steps
```

`fallback` 也用同样的 JSON 结构：

```python
FALLBACK = [{"step": ["chat"]}]
```

---

## 形态二：边规划边执行（agent loop）

### 适用场景

步骤数不确定、需要看中间结果再决定下一步的任务。比如查快递：可能一次查到，也可能查不到要换关键词，甚至要反问用户。

**用户说**：「帮我查一下快递到哪了。」

**机器人怎么做**：

1. **第 1 轮**：看状态，还没查过 → 决定用手机号查。
2. 执行查询，没查到，把「查不到」写进状态。
3. **第 2 轮**：看状态，手机号没查到 → 决定改用订单号查。
4. 执行查询，查到了，把结果写进状态。
5. **第 3 轮**：看状态，已经查到 → 决定结束。

### 骨架

```text
START → decide → act → 条件边
          ↑        │
          └──继续──┤
                   │结束
                   ↓
                  END
```

`decide` 看当前状态，决定下一个动作；`act` 执行动作，把结果写回状态；条件边决定继续还是结束。

```python
MAX_ROUNDS = 6


async def decide_node(state):
    # 看当前状态，决定下一步：查手机号 / 查订单号 / 直接回答 / 结束
    return {"next_action": pick_action(state)}


async def act_node(state):
    writer = get_stream_writer()
    result = await run_action(state["next_action"], state)
    return {
        "result": result,
        "round": state.get("round", 0) + 1,
        "done": is_done(result),
    }


def should_continue(state):
    if state.get("done") or state.get("round", 0) >= MAX_ROUNDS:
        return "end"
    return "decide"


def compile_loop(*, decide_node, act_node):
    graph = StateGraph(State)
    graph.add_node("decide", decide_node)
    graph.add_node("act", act_node)
    graph.add_edge(START, "decide")
    graph.add_edge("decide", "act")
    graph.add_conditional_edges("act", should_continue, {
        "decide": "decide",
        "end": END,
    })
    return graph.compile()
```

关键点：`round` 计数必须有，否则可能一直转；`done` 由 `act` 根据结果设置。

---

## 形态三：混合

### 适用场景

大骨架稳定、小步骤需要灵活的任务。比如写竞品分析：先调研、再写报告是固定的，但调研要查几轮、报告要改几遍，事先说不准。

**用户说**：「帮我写一份竞品分析。」

**机器人怎么做**：

1. 外层计划定好：先调研，再写报告。
2. **调研内部**走 agent loop：查一家、看够不够、不够再查，直到信息够了。
3. **写报告内部**也走 loop：写一版、检查、不行就改，直到通过。
4. 外层拿到结果，结束。

### 骨架

```text
START → plan → agents → END
                │
                └─ 每个步骤内部是一个 loop
```

外层用一次性规划的写法，内层的某个节点自己跑一个 loop。

```python
async def research_node(state):
    """外层的一个步骤，内部自己走 agent loop。"""
    writer = get_stream_writer()
    sub = compile_loop(decide_node=research_decide, act_node=research_act)
    async for chunk in sub.astream(state, stream_mode="custom"):
        writer(chunk)
    return {}


async def reply_node(state):
    writer = get_stream_writer()
    sub = compile_loop(decide_node=write_decide, act_node=write_act)
    async for chunk in sub.astream(state, stream_mode="custom"):
        writer(chunk)
    return {}


def compile_hybrid(*, plan_node):
    agent_map = {"research": research_node, "reply": reply_node}
    allowed = {"research", "reply"}
    return compile_once(
        plan_node=plan_node,
        agent_map=agent_map,
        allowed=allowed,
        fallback=[{"step": ["research"]}, {"step": ["reply"]}],
    )
```

关键点：外层还是 `plan → agents`，某个节点内部再跑一个 loop；子图事件记得转发，转发前先取父图的 writer。

---

## 三种形态对比

| | 计划什么时候定 | 中间能改吗 | 步骤数 | 典型场景 |
|---|---|---|---|---|
| 一次性规划 | 开始前一次定好 | 不能 | 固定 | 客服答退货：先查后解释 |
| agent loop | 每一步现定 | 能 | 不固定 | 查快递：查不到就换关键词 |
| 混合 | 外层定，内层现定 | 内层能 | 外层固定、内层不固定 | 写竞品报告：先调研再写，内部多轮 |

判断方法：

- 「几步、每步做什么」能提前写清楚 → 一次性规划。
- 下一步取决于上一步的结果 → agent loop。
- 两者都有 → 混合。

---

两篇都自包含，第一篇末尾指向第二篇，第二篇开头指回第一篇。需要我再补一个「完整可运行的最小示例」作为附录吗？