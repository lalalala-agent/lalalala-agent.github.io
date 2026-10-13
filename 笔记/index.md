---
layout: home

hero:
  name: 个人知识库
  tagline: 按问题查阅。每篇单独成立，先选栏目，再进一篇。
  actions:
    - theme: brand
      text: 智能体设计
      link: /agent设计/
    - theme: alt
      text: LLM 推理
      link: /LLM推理/

features:
  - title: 智能体设计
    details: 常驻运行时的架构、身份、记忆与主动运行，以及 LangGraph 的流式输出、多机器人和规划执行。
    link: /agent设计/
  - title: LLM 推理
    details: vLLM 的 prefill 与缓存、4090 在线日志，以及 RK3588 上的打包和端侧性能。
    link: /LLM推理/
  - title: LLM 训练
    details: BERT 做短文本分类，LoRA 做领域指令跟随，从语料写到交到推理服务。
    link: /LLM训练/
  - title: 语音交互
    details: 语音套件、降噪和全双工打断。提纲已列，正文还在写。
    link: /语音交互/
---

<div class="home-map">
  <section>
    <h2><a href="/agent设计/">智能体设计</a></h2>
    <p class="lead">运行时怎么分层，图怎么流式、怎么同时接多台机器人。</p>
    <p class="label">运行时</p>
    <ul>
      <li><a href="/agent设计/OpenClaw智能体架构">智能体架构</a></li>
      <li><a href="/agent设计/OpenClaw系统提示词">身份与系统提示词</a></li>
      <li><a href="/agent设计/OpenClaw工具与技能">工具与技能</a></li>
      <li><a href="/agent设计/OpenClaw记忆系统">记忆系统</a></li>
      <li><a href="/agent设计/OpenClaw上下文工程">上下文工程</a></li>
      <li><a href="/agent设计/OpenClaw定时与主动运行">定时与主动运行</a></li>
    </ul>
    <p class="label">LangGraph</p>
    <ul>
      <li><a href="/agent设计/LangGraph流式输出">流式输出</a></li>
      <li><a href="/agent设计/LangGraph+FastAPI多机器人设计">多机器人运行时</a></li>
      <li><a href="/agent设计/LangGraph规划和执行">规划与执行</a></li>
    </ul>
  </section>

  <section>
    <h2><a href="/LLM推理/">LLM 推理</a></h2>
    <p class="lead">服务端怎么跑，端侧边界在哪里。</p>
    <p class="label">服务端</p>
    <ul>
      <li><a href="/LLM推理/vLLM推理">vLLM 推理</a></li>
      <li><a href="/LLM推理/KV缓存与前缀缓存">KV 缓存与前缀缓存</a></li>
      <li><a href="/LLM推理/Qwen3.5-4090性能">Qwen3.5-4090 性能</a></li>
    </ul>
    <p class="label">端侧</p>
    <ul>
      <li><a href="/LLM推理/RK3588硬件">RK3588 硬件</a></li>
      <li><a href="/LLM推理/RK3588模型打包">RK3588 模型打包</a></li>
      <li><a href="/LLM推理/Qwen3-VL端侧性能">Qwen3-VL 端侧性能</a></li>
    </ul>
  </section>

  <section>
    <h2><a href="/LLM训练/">LLM 训练</a></h2>
    <p class="lead">分类和指令跟随各一篇，写的是怎么选数据和参数。</p>
    <ul>
      <li><a href="/LLM训练/BERT微调">BERT 微调</a></li>
      <li><a href="/LLM训练/LoRA微调">LoRA 微调</a></li>
    </ul>
  </section>

  <section>
    <h2><a href="/语音交互/">语音交互</a></h2>
    <p class="lead">还没成稿。目录里目前只有编写提纲。</p>
    <ul>
      <li><a href="/语音交互/">硬件套件、降噪、全双工打断</a></li>
    </ul>
  </section>
</div>
