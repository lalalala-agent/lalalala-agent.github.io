# LangGraph 规划与执行的三种形态

同样一张图，内部可以有不同的「决定下一步做什么」的方式。本文讲三种常见形态，以及各自适合什么场景。

每种形态都给出两个版本：

- **LangGraph 版**：用 `StateGraph` 组织节点和边，适合需要流式转发、状态管理、多流程复用的场景。
- **原生 OpenAI 版**：只用 Chat Completions + function calling，循环由你自己的 Python 代码控制，适合理解底层机制或轻量接入。

三个例子统一用**咖啡店机器人**场景，方便对照。

## 场景设定

咖啡店机器人有以下工具：

- `search_menu`：查菜单（有哪些咖啡、价格、口味）
- `check_stock`：查原料和机器状态（豆子够不够、机器忙不忙、杯子还有没有）
- `make_coffee`：做咖啡
- `recommend`：根据口味推荐一款

三个形态分别对应三种任务，后面逐个展开。

---

## 形态一：一次性规划

### 典型场景

用户说：「我想喝点不太苦的。」

**为什么适合一次性规划**：口味偏好能提前枚举——不苦、低酸、果香、奶味重。不管菜单返回什么，下一步永远是「按口味筛、推荐」。分支在规划时就能想全，所以可以把「查菜单 → 推荐」这个套路定死。

### 优点

路径固定，可以校验。如果模型规划出 `search_menu → recommend`，就照着走；如果规划出 `delete_menu` 这种不存在的动作，直接退回默认流程。执行前还能人工审核计划，适合需要审计的场景。

### 缺点

**同一轮执行中，计划不会根据中间结果调整。** 如果 `search_menu` 发现菜单里根本没有「不太苦」这个分类，它不会自己改成「换个关键词再查」，只能按原计划把结果交给 `recommend` 兜底。需要中途调整时，得等下一轮重新规划。

注意：用户改口属于**新的一轮对话**，会重新走一次 `plan → agents`，重新规划，这不算缺点。一次性规划的限制只在「一轮之内」。

### 计划用 JSON 表示

```json
[
  {"step": ["search_menu"]},
  {"step": ["recommend"]}
]
```

外层是数组，表示顺序执行的步骤；每个步骤里的 `step` 是数组，表示这一步要并行执行的动作。上例意思是：先 `search_menu`，再 `recommend`。

要并行，就往同一个 `step` 里放多个名字：

```json
[
  {"step": ["search_menu", "check_stock"]},
  {"step": ["recommend"]}
]
```

意思是：先同时查菜单和库存，两个都完成后再推荐。

### LangGraph 版骨架

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
    return {"plan": [{"step": ["search_menu"]}, {"step": ["recommend"]}]}
```

### 解析与校验

```python
def parse_plan(plan, allowed, fallback):
    """把 JSON 计划归一成 list[list[str]]：外层顺序，内层并行。"""
    def normalize(raw):
        if not isinstance(raw, list):
            return []
        steps = []
        for item in raw:
            names = item.get("step") if isinstance(item, dict) else item
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
FALLBACK = [{"step": ["recommend"]}]
```

### 原生 OpenAI 版

关键点：**先让模型只产出计划，不调工具；再按计划逐步执行。**

```python
import json
import openai

client = openai.OpenAI()

TOOLS = [{
    "type": "function",
    "function": {
        "name": "search_menu",
        "description": "查咖啡菜单，返回咖啡名、价格、口味",
        "parameters": {
            "type": "object",
            "properties": {"keyword": {"type": "string"}},
            "required": ["keyword"],
        },
    },
}, {
    "type": "function",
    "function": {
        "name": "recommend",
        "description": "根据口味推荐一款咖啡",
        "parameters": {
            "type": "object",
            "properties": {"taste": {"type": "string"}},
            "required": ["taste"],
        },
    },
}]


def plan_once(user_input: str) -> list:
    """第一步：只产出计划，不给 tools，逼模型输出 JSON。"""
    response = client.chat.completions.create(
        model="gpt-4o",
        messages=[{
            "role": "system",
            "content": "你是规划器。只输出 JSON 计划，格式 "
                       '[{"step": ["工具名"]}, ...]。'
                       "可用工具：search_menu, recommend。不要执行。",
        }, {
            "role": "user",
            "content": user_input,
        }],
        response_format={"type": "json_object"},
    )
    return json.loads(response.choices[0].message.content)


def execute_tool(name: str, args: dict) -> str:
    if name == "search_menu":
        return "菜单：美式（苦）、拿铁（奶味重）、卡布奇诺（苦）、摩卡（甜）"
    if name == "recommend":
        return "推荐：拿铁，奶味重、苦味淡"
    return "未知工具"


def run_once(user_input: str):
    plan = plan_once(user_input)   # [{"step": ["search_menu"]}, {"step": ["recommend"]}]
    messages = [{"role": "user", "content": user_input}]

    for step in plan:
        for tool_name in step["step"]:
            response = client.chat.completions.create(
                model="gpt-4o",
                messages=messages + [{
                    "role": "system",
                    "content": f"当前步骤：调用 {tool_name}。",
                }],
                tools=[t for t in TOOLS if t["function"]["name"] == tool_name],
                tool_choice={"type": "function", "function": {"name": tool_name}},
            )
            msg = response.choices[0].message
            if msg.tool_calls:
                messages.append(msg)
                for call in msg.tool_calls:
                    result = execute_tool(call.function.name, json.loads(call.function.arguments))
                    messages.append({
                        "role": "tool",
                        "tool_call_id": call.id,
                        "content": result,
                    })

    final = client.chat.completions.create(model="gpt-4o", messages=messages)
    return final.choices[0].message.content
```

和 LangGraph 版的对应关系：`plan_once` = `plan_node`；`for step in plan` = `agents_node`；`execute_tool` = 能力表里的各个节点。

---

## 形态二：边规划边执行（agent loop）

### 典型场景

用户说：「帮我做一杯提神的。」

**为什么适合 agent loop**：这件事的下一步取决于「机器现在有什么」，而这个信息事先不知道：

- 豆子够、机器空闲 → 直接做。
- 豆子不够 → 先补豆，再确认机器状态，再做。
- 机器正忙 → 等一会儿，再查状态，再做。
- 杯子没了 → 先补杯，再补豆，再做。

你事先写不出固定计划，因为「现在缺什么」只有查了才知道，而缺什么决定了接下来要做几件事、做哪几件。分支必须现场查了才知道，这才需要 agent loop。

### 优点

能处理「下一步取决于现场状态」的任务。缺豆就补豆、机器忙就等，事先不用穷举所有分支。

### 缺点

现场状态可能让循环停不下来。比如机器一直忙，模型可能反复查状态、反复等，轮数用满才退出。必须设 `MAX_ROUNDS`，否则成本和耗时不可控。

### LangGraph 版骨架

```text
START → decide → act → 条件边
          ↑        │
          └──继续──┤
                   │结束
                   ↓
                  END
```

```python
MAX_ROUNDS = 6


async def decide_node(state):
    # 看当前状态，决定下一步：补豆 / 等机器 / 做咖啡 / 结束
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

### 原生 OpenAI 版

就是最基础的 agent loop：模型每轮自己决定调什么工具，你负责执行、拼回 `messages`，并判断什么时候算完。

```python
def run_agent_loop(user_input: str, max_rounds: int = 6):
    messages = [{"role": "user", "content": user_input}]

    for _ in range(max_rounds):
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            tools=TOOLS,
        )
        msg = response.choices[0].message

        # 模型不再要求调工具 -> 给出最终回答，结束
        if not msg.tool_calls:
            return msg.content

        messages.append(msg)
        for call in msg.tool_calls:
            result = execute_tool(call.function.name, json.loads(call.function.arguments))
            messages.append({
                "role": "tool",
                "tool_call_id": call.id,
                "content": result,
            })

    return "达到最大轮数"
```

和 LangGraph 版的对应关系：`decide` = 模型每轮自己决定 `tool_calls`；`act` = `execute_tool` + 拼回 `messages`；`should_continue` = `if not msg.tool_calls: return` 加上你自己判断的 `done`；`round` 上限 = `max_rounds`。

---

## 形态三：混合

### 典型场景

用户说：「帮我挑一款适合送人的咖啡豆。」

**为什么适合混合**：大骨架稳定——先调研几款、再写推荐语；但每一步内部不定——调研要查几款才够、推荐语要改几遍才满意，事先说不准。

### 优点

外层保证大方向不偏，内层保证细节灵活。调研内部可以查两款、三款，推荐内部可以改两版，外层只关心「调研完了没、推荐写好了没」。

### 缺点

结构复杂。外层计划和内层 loop 的边界要划清楚——如果外层计划里也做「判断够不够」，内层 loop 里也做，就会两层互相干扰。调试时也要同时看两层日志。

### LangGraph 版骨架

```text
START → plan → agents → END
                │
                └─ 每个步骤内部是一个 loop
```

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

### 原生 OpenAI 版

外层按计划顺序走，某个步骤内部自己跑一个 `run_agent_loop`。

```python
def research_step(user_input: str) -> str:
    """内层 loop：查够 2 款咖啡豆就停。"""
    messages = [{
        "role": "user",
        "content": f"调研以下任务：{user_input}。查够 2 款咖啡豆就够了。",
    }]
    for _ in range(4):
        response = client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
            tools=[t for t in TOOLS if t["function"]["name"] == "search_menu"],
        )
        msg = response.choices[0].message
        if not msg.tool_calls:
            return msg.content
        messages.append(msg)
        for call in msg.tool_calls:
            result = execute_tool(call.function.name, json.loads(call.function.arguments))
            messages.append({"role": "tool", "tool_call_id": call.id, "content": result})
    return "调研完成"


def run_hybrid(user_input: str):
    plan = plan_once(user_input)   # [{"step": ["research"]}, {"step": ["reply"]}]
    findings = []

    for step in plan:
        for tool_name in step["step"]:
            if tool_name == "research":
                findings.append(research_step(user_input))  # 内部自己 loop
            elif tool_name == "reply":
                pass  # 用 findings 生成推荐语

    return "推荐语已生成"
```

和 LangGraph 版的对应关系：外层 `for step in plan` = `compile_once` 里的 `agents_node`；内层 `research_step` = `research_node` 里 `compile_loop(...).astream(...)`；`findings` = 子图写回父状态的那部分。

---

## 三种形态对比

| | 计划什么时候定 | 中间能改吗 | 步骤数 | 典型场景 |
|---|---|---|---|---|
| 一次性规划 | 开始前一次定好 | 一轮内不能 | 固定 | 按口味推荐：先查菜单再推荐 |
| agent loop | 每一步现定 | 能 | 不固定 | 做一杯提神的：缺什么补什么 |
| 混合 | 外层定，内层现定 | 内层能 | 外层固定、内层不固定 | 挑送人咖啡豆：先调研再写，内部多轮 |

判断方法：

- 「几步、每步做什么」能提前写清楚 → 一次性规划。
- 下一步取决于现场状态，且分支事先想不全 → agent loop。
- 两者都有 → 混合。

**注意**：三种形态都能在轮与轮之间重新规划（用户改口就是新的一轮）。区别在于**一轮之内能不能根据中间结果调整**：一次性规划不能，agent loop 能，混合的内层能。

---

## LangGraph 版和原生 OpenAI 版的取舍

| | LangGraph 版 | 原生 OpenAI 版 |
|---|---|---|
| 循环控制 | 图结构 + 条件边 | 你自己的 `for` / `while` |
| 流式转发 | `get_stream_writer()` 原生支持 | 自己往外传 |
| 多流程复用 | 注册表 + 编译一次 | 自己组织函数 |
| 子图嵌套 | `compile().astream()` 原生支持 | 普通函数调用 |
| 适合场景 | 多机器人、多流程、要流式 | 理解机制、轻量接入 |