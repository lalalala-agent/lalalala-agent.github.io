---
layout: home

hero:
  name: 个人知识库
---

<div class="home-map">
  <div class="row row-main">
    <section>
      <div class="intro">
        <h2>
          <a href="/agent设计/">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="6" cy="12" r="2.25"/><circle cx="18" cy="6" r="2.25"/><circle cx="18" cy="18" r="2.25"/><path d="M8.2 11.1 15.8 7.2M8.2 12.9l7.6 4"/></svg>
            <span>智能体设计</span>
          </a>
        </h2>
        <p class="lead">运行时怎么分层，图怎么流式、怎么同时接多台机器人。</p>
      </div>
      <div class="entries">
        <div class="group">
          <p class="label">运行时</p>
          <ul>
            <li><a href="/agent设计/OpenClaw智能体架构">智能体架构</a></li>
            <li><a href="/agent设计/OpenClaw系统提示词">身份与系统提示词</a></li>
            <li><a href="/agent设计/OpenClaw工具与技能">工具与技能</a></li>
            <li><a href="/agent设计/OpenClaw记忆系统">记忆系统</a></li>
            <li><a href="/agent设计/OpenClaw上下文工程">上下文工程</a></li>
            <li><a href="/agent设计/OpenClaw定时与主动运行">定时与主动运行</a></li>
          </ul>
        </div>
        <div class="group">
          <p class="label">LangGraph</p>
          <ul>
            <li><a href="/agent设计/LangGraph流式输出">流式输出</a></li>
            <li><a href="/agent设计/LangGraph+FastAPI多机器人设计">多机器人运行时</a></li>
            <li><a href="/agent设计/LangGraph规划和执行">规划与执行</a></li>
          </ul>
        </div>
      </div>
    </section>
    <section>
      <div class="intro">
        <h2>
          <a href="/LLM推理/">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M9 3v3M12 3v3M15 3v3M9 18v3M12 18v3M15 18v3M3 9h3M3 12h3M3 15h3M18 9h3M18 12h3M18 15h3"/></svg>
            <span>LLM 推理</span>
          </a>
        </h2>
        <p class="lead">服务端怎么跑，端侧边界在哪里。</p>
      </div>
      <div class="entries">
        <div class="group">
          <p class="label">服务端</p>
          <ul>
            <li><a href="/LLM推理/vLLM 的显存、Block 与并发调度">显存、Block 与并发</a></li>
            <li><a href="/LLM推理/KV Cache 与 Prefix Caching 的调度流程">KV Cache 调度</a></li>
            <li><a href="/LLM推理/Prefix Caching">Prefix Caching</a></li>
            <li><a href="/LLM推理/Qwen3.8-27B并发压测报告">Qwen3.8-27B 压测</a></li>
            <li><a href="/LLM推理/MoE和Dense架构对比">MoE 与 Dense</a></li>
          </ul>
        </div>
        <div class="group">
          <p class="label">端侧</p>
          <ul>
            <li><a href="/LLM推理/RK3588 与 RK1828 硬件架构">RK3588 与 RK1828</a></li>
            <li><a href="/LLM推理/RK3588 部署LLM">RK3588 部署 LLM</a></li>
            <li><a href="/LLM推理/RK3588 Qwen3-VL端侧性能">Qwen3-VL 端侧性能</a></li>
          </ul>
        </div>
      </div>
    </section>
  </div>
  <div class="row row-side">
    <section>
      <div class="intro">
        <h2>
          <a href="/语音交互/">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 10v4M8 7v10M12 4v16M16 8v8M20 11v2"/></svg>
            <span>语音交互</span>
          </a>
        </h2>
        <p class="lead">拾音结构、前端处理，以及唤醒到播报的整段状态。</p>
      </div>
      <div class="entries">
        <div class="group">
          <ul>
            <li><a href="/语音交互/声学硬件结构">声学硬件结构</a></li>
            <li><a href="/语音交互/语音前端处理">语音前端处理</a></li>
            <li><a href="/语音交互/语音交互流程">语音交互流程</a></li>
          </ul>
        </div>
      </div>
    </section>
    <section>
      <div class="intro">
        <h2>
          <a href="/具身智能/">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="7" y="8" width="10" height="7" rx="2"/><path d="M12 8V5.2"/><circle cx="12" cy="4" r="1"/><path d="M10 11.5h.01M14 11.5h.01M9 15.5 7.5 19M15 15.5l1.5 3.5M7 11.5H4.5M17 11.5H19.5"/></svg>
            <span>具身智能</span>
          </a>
        </h2>
        <p class="lead">指令怎么变成 Skill，动作怎么经过规划交到电机。</p>
      </div>
      <div class="entries">
        <div class="group">
          <ul>
            <li><a href="/具身智能/robot agent设计">Robot Agent</a></li>
            <li><a href="/具身智能/机器人运动控制与电机驱动架构">运动控制与电机驱动</a></li>
          </ul>
        </div>
      </div>
    </section>
    <section>
      <div class="intro">
        <h2>
          <a href="/LLM训练/">
            <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l9 5-9 5-9-5 9-5z"/><path d="M3 12l9 5 9-5"/><path d="M3 17l9 5 9-5"/></svg>
            <span>LLM 训练</span>
          </a>
        </h2>
        <p class="lead">表情分类和领域指令，写的是数据和怎么训完交付。</p>
      </div>
      <div class="entries">
        <div class="group">
          <ul>
            <li><a href="/LLM训练/BERT微调">BERT 微调</a></li>
            <li><a href="/LLM训练/LoRA微调">LoRA 微调</a></li>
          </ul>
        </div>
      </div>
    </section>
  </div>
</div>
