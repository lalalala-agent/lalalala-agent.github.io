# 定时任务与主动运行

> 面向开源开发者的技术文档。描述 Agent 框架如何在不依赖用户输入的情况下主动发起一轮执行。

---

## 一、总览

Agent 不必等下一句对话才工作。以下三类事件都可以由运行时主动发起一轮：

| 唤醒 | 触发 | 特点 |
| --- | --- | --- |
| **到点任务** | 调度器扫描发现任务到期 | 不调用模型；任务记录在持久存储里 |
| **心跳** | 按固定周期发起一轮模型调用 | 回答「现在有没有需要人知道的事」 |
| **感知事件** | 现场变化变成事件 | 走与对话相同的执行路径，不必等用户先说话 |

**共同点：唤醒由宿主决定，模型只负责被唤醒后的那一轮。**

### 1.1 用户主动提问

作为对照，先说最熟悉的第四种方式：**用户主动提问**。

用户发一条消息，运行时收到后发起一轮，模型回复。这是**被动触发**——由用户决定何时开始，运行时不主动做任何事。

| 维度 | 用户提问 |
| --- | --- |
| **谁决定发起** | 用户 |
| **触发源** | 用户消息 |
| **典型表达** | 「今天天气怎么样？」「帮我写封邮件」 |
| **会话** | 恢复日常会话，带近期历史 |
| **结果去向** | 直接回复给用户 |

它和下面三种主动唤醒共用同一个执行核心，区别只在参数：`use_session = true`（恢复日常会话）、结果直接回复、不涉及通知补发。

### 1.2 四种触发方式对比

```
Agent 一轮执行的触发方式
├── 被动触发
│   └── 用户提问（用户发消息 → 运行时响应）
└── 主动触发
    ├── 到点任务
    ├── 心跳
    └── 感知事件
```

| 维度 | 用户提问 | 到点任务 | 心跳 | 感知事件 |
| --- | --- | --- | --- | --- |
| **谁决定发起** | 用户 | 宿主（调度器） | 宿主（周期） | 宿主（感知通道） |
| **触发源** | 用户消息 | 时间点/周期到了 | 固定周期到了 | 现场变化 |
| **调度器是否调模型** | — | 否（执行时才调） | 是（每次都调） | 否（事件触发后调） |
| **动作是否预先写死** | 否 | 是（prompt 存库） | 否（模型每次判断） | 否（模型根据事件决定） |
| **典型用户表达** | 「今天天气怎么样？」 | 「1 分钟后提醒我喝水」 | 「帮我看着收件箱」 | （用户不表达，现场触发） |

**架构分层：**

```
┌─────────────────────────────────────────────┐
│  通道层      接收用户消息 / 发送主动消息        │
├─────────────────────────────────────────────┤
│  调度层      扫描到期任务 / 心跳周期 / 感知事件  │  ← 唤醒
├─────────────────────────────────────────────┤
│  执行层      统一执行核心（对话 / 任务 / 心跳）  │  ← 模型决策
├─────────────────────────────────────────────┤
│  存储层      任务表 / 会话状态 / 记忆           │  ← 持久化
└─────────────────────────────────────────────┘
```

---

## 二、到点任务

### 2.1 是什么

用户或模型事先设定一个任务，记录在持久存储里。调度器周期扫描，发现到点就执行。

**调度器本身不调用模型**，是任务到点后执行那一轮才调用模型。

### 2.2 特点

- 有明确的执行时间点或周期
- 任务内容提前写好（prompt 存数据库）
- 不依赖现场变化，也不依赖用户当时在不在
- 任务记录在数据库里，进程重启后还在

### 2.3 举例

| 用户说的话 | 系统行为 |
| --- | --- |
| 「1 分钟后提醒我喝水」 | 调度器 1 分钟后扫到任务，发起一轮，模型调 `send_message` 发出提醒 |
| 「每天早上 9 点搜索科技新闻，把摘要发给我」 | 每天 9 点调度器扫到任务，发起一轮，模型搜索、总结、发送 |
| 「周五下午 5 点提醒我提交周报」 | 周五 17:00 触发 |

### 2.4 调度器

调度器是运行时里的一个**周期扫描，不调用模型**。它每隔一段时间查看持久存储里哪些任务的下一次执行时间已经到了；没有到期任务时，这一次扫描就是一次查询。

```pseudo
function scheduler_loop(store, interval):
    loop forever:
        due = store.query_due_tasks(now_utc())
        for task in due:
            execute_task_serial(task)      # 串行，不并发
        sleep(interval)
```

- 提醒不需要亚秒精度，扫描间隔用**几十秒**这一档就够。
- 任务由模型通过工具写入，写入的是**数据库里的一条记录**，不是模型自己设的内存定时器。
- 模型不能绕过这份记录直接「记住下次提醒」，真正到点把任务跑起来的仍然是调度器。

### 2.5 任务记录

一条任务至少保存：

| 字段 | 说明 |
| --- | --- |
| `id` | 任务唯一标识 |
| `session_id` | 属于哪个会话 |
| `prompt` | 要执行的提示 |
| `schedule_type` | 日程类型 |
| `schedule_value` | 日程取值 |
| `next_run` | 下一次执行时间 |
| `last_run` | 上一次执行时间 |
| `last_result` | 上一次执行结果 |
| `status` | 状态（至少进行中、暂停、已完成） |
| `created_at` | 创建时间 |

对 `next_run` 和 `status` 建索引，让到期查询走索引而不是全表扫描。

```sql
CREATE TABLE scheduled_tasks (
    id              TEXT PRIMARY KEY,
    session_id      TEXT NOT NULL,
    prompt          TEXT NOT NULL,
    schedule_type   TEXT NOT NULL,
    schedule_value  TEXT NOT NULL,
    next_run        TEXT,
    last_run        TEXT,
    last_result     TEXT,
    status          TEXT DEFAULT 'active',
    created_at      TEXT NOT NULL
);
CREATE INDEX idx_tasks_next_run ON scheduled_tasks(next_run);
CREATE INDEX idx_tasks_status   ON scheduled_tasks(status);
```

### 2.6 三种日程类型

| 类型 | 取值 | 执行后 |
| --- | --- | --- |
| **按日历重复** | 一条日历表达式，按运行时区解释 | 算出下一次，状态保持进行中；时区设错，表达式会在错误的钟点触发 |
| **按间隔重复** | 一段时长 | 从本次执行时刻再推一段，而不是从原来的计划时刻补齐中间每一次 |
| **到点一次** | 一个时间点 | 标记完成，不再运行 |

**统一时间格式：** 三种类型最终都把 `next_run` 转成 **UTC ISO 字符串**存储和比较，避免时区混乱。

这一处是易错点，用 Python 精确表达：

```python
def calculate_next_run(schedule_type, schedule_value, *, now=None, tz=None):
    current = now or datetime.now(timezone.utc)
    current_utc = current.astimezone(timezone.utc)
    local_tz = tz or SCHEDULE_TIMEZONE

    if schedule_type == "cron":
        local_now = current_utc.astimezone(local_tz)
        next_run = croniter(schedule_value, local_now).get_next(datetime)

    elif schedule_type == "interval":
        interval_ms = int(schedule_value)
        if interval_ms <= 0:
            raise ValueError("interval must be positive")
        # 从本次执行时刻再推一段，不补齐停机期间
        next_run = current_utc + timedelta(milliseconds=interval_ms)

    elif schedule_type == "once":
        next_run = datetime.fromisoformat(schedule_value.replace("Z", "+00:00"))
        if next_run.tzinfo is None:
            next_run = next_run.replace(tzinfo=local_tz)
        if next_run.astimezone(timezone.utc) <= current_utc:
            raise ValueError("once timestamp must be in the future")

    else:
        raise ValueError(f"unknown schedule_type: {schedule_type}")

    return next_run.astimezone(timezone.utc).isoformat()
```

**各类型的处理差异：**

- **日历重复**：先把当前 UTC 时间转成运行时区，再算下一次。
- **间隔重复**：从**本次执行时刻**再推一段，而不是从原来的计划时刻补齐中间每一次。停机很久不会连着补很多次。
- **到点一次**：解析 ISO 时间戳；无 offset 时按运行时区解释；必须是在未来，否则报错。

### 2.7 任务管理工具

模型可以列出、暂停、恢复、取消任务，这些工具**只改存储，不调用模型**。

```pseudo
tool schedule_task(prompt, schedule_type, schedule_value):
    next_run = calculate_next_run(schedule_type, schedule_value)
    id = store.insert_task(session_id, prompt, schedule_type, schedule_value, next_run)
    return "任务 {id} 已创建。下次执行：{next_run}"

tool list_tasks():
    return store.query_all_tasks()

tool pause_task(task_id):
    return store.update_status(task_id, "paused")

tool resume_task(task_id):
    task = store.get_task(task_id)
    next_run = calculate_next_run(task.schedule_type, task.schedule_value, now=now_utc())
    return store.update(task_id, status="active", next_run=next_run)   # 按恢复时刻重算

tool cancel_task(task_id):
    return store.delete_task(task_id)
```

**暂停后再恢复时，按恢复的时刻重算下一次执行时间**，避免一恢复就把停机期间积压的那一轮立刻补上。

### 2.8 并发与超时

- 多个任务同时到期，**串行执行**。
- 单次执行设**超时**：超时后记录失败、释放执行权，并告诉用户这一次没有完成。

```pseudo
function execute_task_serial(task):
    try:
        result = with_timeout(TASK_TIMEOUT, run_task_agent(task))
        on_success(task, result)
    except Timeout:
        store.mark_failed(task.id, "timeout")
        notify_user(task.session_id, "这一次没有完成")
    except Error as e:
        store.mark_failed(task.id, str(e))
```

### 2.9 停机恢复

进程停过一段时间再启动时，已过期的任务会在下一次扫描里被看到。

- **一次性提醒**：应该补跑。
- **按间隔的高频任务**：如果停机很久会连着补很多次。任务变多之后，改成**每个任务只补最近一次**。

```pseudo
function query_due_tasks(now):
    all_due = store.query(status="active", next_run <= now)

    result = []
    seen = {}
    for task in all_due:
        if task.schedule_type == "interval":
            if task.id in seen:
                continue              # 已有更新的，跳过旧的
            seen[task.id] = true
        result.append(task)
    return result
```

---

## 三、心跳

### 3.1 是什么

运行时按固定周期**主动发起一轮模型调用**，问模型「现在有没有需要人知道的事」。

和到点任务的区别：到点任务是「到某个时间做某件具体的事」，心跳是「周期性检查有没有情况」。

### 3.2 适用场景

| 适合心跳 | 适合定时任务 |
| --- | --- |
| 「帮我看着某个目录、收件箱或日历，有情况再叫我」 | 「每天某个钟点发一份摘要」 |
| 需要周期性判断状态 | 「几分钟后提醒一件具体的事」 |

### 3.3 举例

| 用户说的话 | 系统行为 |
| --- | --- |
| 「帮我看着收件箱，有重要邮件再叫我」 | 每隔 30 分钟心跳一次，模型检查收件箱，有重要邮件才发消息，没有就静默 |
| 「盯着这个目录，有新文件告诉我」 | 每隔一段时间检查目录，有变化才通知 |
| 「帮我留意日历，快开会了提醒我」 | 周期性检查日历，临近会议才提醒 |

**关键点：** 心跳每次都会调用模型去「判断」，而不是执行一个预先写好的固定动作。

### 3.4 四条规则

心跳在实现上是一条**用户不能删除的内部周期任务**，和普通任务共用执行、超时和投递。额外有四条规则：

**规则 1：独立短会话**

> 不携带日常聊天的长历史。

如果心跳复用日常对话的会话，每次心跳都会把用户几天的聊天记录重新发一遍。费用按心跳次数乘上去，而且闲聊会盖住这次巡检的目标。

```pseudo
# 错误：复用日常会话
result = run_agent(prompt=checklist, session=日常会话)   # 带上几天的聊天记录

# 正确：独立短会话
result = run_agent(prompt=checklist, session=new_short_session())
```

**规则 2：清单写短**

> 要求模型严格按清单检查；清单放在工作区的一份短文件里。

如果提示词写得很长、很含糊，模型会自由发挥，每次巡检角度都不一样，结果不可控，token 也浪费。

```markdown
<!-- heartbeat_checklist.md -->
- 检查收件箱有没有重要邮件
- 检查日历有没有 1 小时内的会议
- 检查指定目录有没有新文件
```

```pseudo
checklist = read_short_file("heartbeat_checklist.md")
result = run_agent(
    prompt = "严格按清单检查。无事只回复 [NO_OP]。\n清单：\n" + checklist
)
```

**好处：** 清单短 → token 少；清单固定 → 每次巡检一致；清单可改 → 调整巡检内容不用改代码。

**规则 3：无事不发**

> 无事时，模型只回复一个约定的标记；宿主看到标记（或去掉标记后所剩无几）就丢掉这轮回复，不发给用户。

心跳大部分时候是「没事」的。如果每次没事也发一条「一切正常」给用户，用户会被骚扰，通道也被占用。

```pseudo
NO_OP_MARKER = "[NO_OP]"

result = run_agent(
    prompt = "严格按清单检查。无事只回复 " + NO_OP_MARKER + "。\n清单：\n" + checklist
)

if is_no_op(result):        # 看到标记，或去掉标记后所剩无几
    return                  # 丢掉，不发
deliver(result)             # 有情况才发

function is_no_op(result):
    stripped = result.replace(NO_OP_MARKER, "").strip()
    return result.contains(NO_OP_MARKER) or len(stripped) < 阈值
```

**规则 4：让路**

> 用户对话或定时任务正在跑时，跳过这一拍——心跳排队没有意义，等它排到时，要看的状态已经变了。

如果用户正在和 Agent 对话，心跳插进来会：两轮抢同一把执行权；把巡检回复插进用户正在说的话中间；等心跳排到时，它要看的状态早就变了。

```pseudo
function heartbeat_tick():
    if agent_busy():
        return              # 规则 4：让路，不排队
    ...
```

**对比：定时任务到期怎么办？**

- **心跳**：跳过。因为心跳是「周期性看看有没有事」，错过一拍，下一拍再看就行。
- **定时任务**：可以在当前轮结束后**串行补上**，但要受超时约束。因为定时任务是「到点必须做的事」，错过就要补。

### 3.5 心跳完整流程

```pseudo
NO_OP_MARKER = "[NO_OP]"

function heartbeat_tick():
    if agent_busy():
        return                                # 规则 4：让路
    if not in_active_hours(now()):
        return                                # 限制时段

    checklist = read_short_file("heartbeat_checklist.md")

    result = run_agent(
        prompt   = "严格按清单检查。无事只回复 " + NO_OP_MARKER + "。\n清单：\n" + checklist,
        session  = new_short_session(),       # 规则 1：独立短会话
        use_session = false,
        can_send = true
    )

    if is_no_op(result):                      # 规则 3：无事不发
        return
    deliver(result)
```

### 3.6 费用控制

费用主要在每次心跳的模型调用。

```
总费用 ≈ 单次调用费用 × 心跳次数

单次调用费用 ∝ 上下文长度（规则 1、2 控制）
心跳次数     ∝ 时间跨度 ÷ 间隔（间隔拉长控制）
             × 有效时段占比（限制时段控制）
             × 无事时的发送比例（无事不发控制）
```

**三个杠杆：**

| 杠杆 | 作用 | 对应 |
| --- | --- | --- |
| **间隔拉长** | 减少单位时间内的调用次数 | 费用控制 |
| **限制时段** | 只在人醒着的时段心跳，夜间不跑 | 费用控制 |
| **无事不发** | 无事时虽然调用了模型，但不发消息，减少通道占用和用户骚扰 | 规则 3 |

**注意区分：**

- **间隔拉长**和**限制时段**是**减少模型调用次数**——直接省钱。
- **无事不发**是**减少发送消息**——模型调用已经发生了，省不了这次调用的钱，但能避免骚扰用户、避免通道浪费。

```pseudo
function should_heartbeat(now):
    if not in_active_hours(now):              # 限制时段：夜间不跑
        return false
    if now - last_heartbeat < INTERVAL:       # 间隔拉长：不到点不跑
        return false
    return true
```

**三件事一起用：**

```
单独用「间隔拉长」
每 30 分钟一次，24 小时跑 → 48 次/天

加「限制时段」
每 30 分钟一次，只在 8:00–22:00 跑 → 28 次/天

再加「无事不发」
28 次调用中，只有 3 次有情况 → 用户只收到 3 条消息
```

### 3.7 四条规则与费用控制的关系

```
                    心跳
                     │
        ┌────────────┼────────────┐
        │            │            │
     规则 1        规则 2       规则 3        规则 4
   独立短会话     清单写短     无事不发       让路
        │            │            │            │
        └─────┬──────┘            │            │
              │                   │            │
         降低单次费用          降低发送量    避免无效轮次
         （上下文短）        （不骚扰用户）  （不抢执行权）
              │                   │            │
              └─────────┬─────────┘            │
                        │                      │
                   费用控制 ←──────────────────┘
                  间隔拉长 + 限制时段
                  （减少调用次数）
```

| 规则 | 省钱方式 | 省的是什么 |
| --- | --- | --- |
| 规则 1：独立短会话 | 降低单次上下文长度 | 单次调用费用 |
| 规则 2：清单写短 | 降低单次上下文长度 | 单次调用费用 |
| 规则 3：无事不发 | 不发送无意义消息 | 通道占用、用户骚扰 |
| 规则 4：让路 | 不产生无效轮次 | 无效调用费用、执行权冲突 |
| 费用控制：间隔拉长 | 减少单位时间调用次数 | 总调用费用 |
| 费用控制：限制时段 | 减少有效时段调用次数 | 总调用费用 |

---

## 四、感知事件

### 4.1 是什么

现场里的变化（有人出现、某人离开、画面里出现需要回应的东西）由感知通道先变成一个事件，运行时用这个事件发起一轮，**不必等用户先说话**。

### 4.2 举例

| 现场变化 | 系统行为 |
| --- | --- |
| 摄像头检测到有人走到门口 | 感知通道生成「有人出现」事件 → 发起一轮 → 模型走迎宾计划 → 说出问候语 |
| 检测到某人离开 | 生成「某人离开」事件 → 发起一轮 → 可能说「再见」或记录 |
| 画面里出现需要回应的东西（如有人举手） | 生成事件 → 发起一轮 → 模型回应 |

### 4.3 与对话相同的执行路径

```
感知侧                          对话侧
───────                        ───────
原始画面
   ↓
检测变化
   ↓
生成事件 ──────────────────→  装入当前场景身份
（只传事件说明）                    ↓
                              走主动问候/迎宾计划
                                   ↓
                              产出要说的话 + 动作
                                   ↓
                              经通道发出
```

**原始画面留在感知侧，对话提示里只放事件说明。**

```pseudo
function on_perception_event(event):
    if event.type == "person_appeared":
        if recently_greeted(event.person, within=COOLDOWN):
            return                            # 不重复问候
        if device_sleeping() or device_speaking() or agent_busy():
            merge_into_current_round(event)   # 让路或并入
            return
        run_proactive_round(event)
```

### 4.4 抑制规则

- 同一个人短时间内重复出现，**不重复问候**；
- 设备处于休眠、正在播报、或已经有一轮对话在进行，这一次感知事件**让路或并入当前轮**，不另起一轮抢着说话。

---

## 五、执行时怎么把结果交到人手里

定时任务和心跳的执行，和日常对话有三处不同：

| 不同 | 规则 |
| --- | --- |
| **独立短会话** | 不恢复日常聊天的会话标识，也不把这次提示追加进日常档案；任务要记住的内容写在任务提示里，心跳要看的内容写在那份短清单里 |
| **必须能通知用户** | 发给执行轮的提示里写明：要用发消息的工具把结果送到这个任务所属的会话，执行轮不把回复只留在模型运行时内部 |
| **忘记发消息时由宿主补发** | 宿主记录这一轮有没有调用过发消息；没有调用，就把任务提示或一轮结果用通道直接送出，避免一次成功的执行变成沉默。心跳的无事标记不适用这条补发——无事本来就不该送出 |

```pseudo
function run_task_agent(task):
    notify_state = {sent: false}

    prompt = "执行任务需要使用 send_message 通知用户。任务：" + task.prompt
    result = run_agent(
        prompt       = prompt,
        session      = task.session_id,
        use_session  = false,             # 独立短会话
        notify_state = notify_state
    )

    if not notify_state.sent:             # 忘记发消息时宿主补发
        deliver(task.session_id, result)

    return result

tool send_message(text):
    channel.send(session_id, text)
    notify_state.sent = true              # 宿主据此判断是否补发
    return "消息已发送。"
```

### 5.1 并发约束

- 用户正在对话时，**心跳跳过**；
- 已经到期的定时任务可以在当前轮结束后**串行补上**，但要受超时约束；
- 同一时刻仍然只有一轮生成——对话进行中如果让心跳插进来，两轮会抢同一把执行权，也会把巡检回复插进用户正在说的话中间。

```pseudo
function acquire_execution_right(current_kind):
    if lock.try_acquire():
        return OK
    if current_kind == "heartbeat":
        return SKIP                       # 心跳让路
    if current_kind == "scheduled_task":
        wait_for_current_round()          # 定时任务串行补上
        lock.acquire()
        return OK
```

---

## 六、执行核心的统一

用户提问、定时任务、心跳、感知事件，应该走**同一个执行核心**，只是参数不同。这保证了几条路径的行为一致。

```pseudo
function run_agent(prompt, session, use_session, notify_state):
    # 1. 组装上下文
    context = build_context(
        identity = load_identity(scene),
        recent   = use_session ? load_recent(session) : [],
        facts    = retrieve_facts(prompt),
        summary  = load_summary(session)
    )

    # 2. 注入通知要求
    if notify_state != null:
        prompt = "执行任务需要使用 send_message 通知用户。" + prompt

    # 3. 调用模型
    result = model.query(
        prompt  = prompt,
        context = context,
        tools   = allowed_tools(scene),
        session = use_session ? resume(session) : null
    )

    # 4. 归档（仅对话）
    if use_session:
        archive_conversation(session, prompt, result)

    return result
```

执行核心至少需要两个开关：

| 开关 | 作用 |
| --- | --- |
| `use_session` | 是否恢复日常会话；定时任务和心跳传 `False` |
| `notify_state` | 记录本轮是否调用过发消息工具；供宿主判断是否补发 |

**四种触发方式的参数对比：**

| 触发方式 | `use_session` | 是否归档 | 通知要求 |
| --- | --- | --- | --- |
| 用户提问 | `true` | 是 | 直接回复 |
| 到点任务 | `false` | 否 | 必须调 `send_message`，忘记时宿主补发 |
| 心跳 | `false` | 否 | 有情况才发，无事静默 |
| 感知事件 | `false` | 否 | 走对话路径发出 |

---

## 七、核心原则总结

| 原则 | 说明 |
| --- | --- |
| **唤醒与生成分离** | 调度器不调用模型；心跳和感知才发起模型调用 |
| **持久化任务** | 任务写在数据库，不是内存定时器；重启后还在 |
| **三种日程** | 日历重复、间隔重复、到点一次，各自有明确的下一次计算规则 |
| **串行 + 超时** | 同时到期串行执行，单次设超时，超时记录失败并通知用户 |
| **停机只补最近一次** | 高频间隔任务停机很久后，不连着补很多次 |
| **心跳四规则** | 短会话、短清单、无事不发、让路 |
| **心跳三杠杆** | 间隔拉长、限制时段、无事不发 |
| **感知有抑制** | 重复出现不重复问候；休眠/播报/对话中让路或并入 |
| **结果必须送达** | 执行轮必须调用发消息工具；忘记时宿主补发 |
| **同时只有一轮** | 对话进行中，心跳跳过，定时任务等当前轮结束后串行补上 |
| **统一执行核心** | 四种触发方式走同一核心，只靠参数区分 |

---

## 八、一句话总结

> 用户提问、到点任务、心跳和感知事件，是 Agent 一轮执行的四种触发方式。用户提问是**被动触发**——用户发消息，运行时响应，恢复日常会话，结果直接回复。另外三种是**主动触发**——唤醒由宿主决定，模型只负责被唤醒后的那一轮。
>
> **到点任务**在时间点执行预先写好的动作，调度器只扫描不调模型。**心跳**按周期真正调用模型判断「有没有情况」，用独立短会话、短清单、无事不发、让路四条规则保证跑得对，用间隔拉长、限制时段、无事不发三个杠杆保证跑得起。**感知事件**由现场变化触发，走与对话相同的执行路径，但原始画面留在感知侧。
>
> 四者走同一个执行核心，只靠 `use_session` 和 `notify_state` 两个开关区分。执行结果必须通过发消息工具送到用户手里，忘记时由宿主补发。