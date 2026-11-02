import{_ as a,o as n,c as p,a2 as t}from"./chunks/framework.DIWxYxwh.js";const b=JSON.parse('{"title":"LLM：基础原理","description":"","frontmatter":{},"headers":[],"relativePath":"LLM训练/LLM基础原理.md","filePath":"LLM训练/LLM基础原理.md","lastUpdated":null}'),e={name:"LLM训练/LLM基础原理.md"};function l(d,s,i,o,c,r){return n(),p("div",null,[...s[0]||(s[0]=[t(`<h1 id="llm-基础原理" tabindex="-1">LLM：基础原理 <a class="header-anchor" href="#llm-基础原理" aria-label="Permalink to &quot;LLM：基础原理&quot;">​</a></h1><hr><h2 id="一、总览-三个核心问题" tabindex="-1">一、总览：三个核心问题 <a class="header-anchor" href="#一、总览-三个核心问题" aria-label="Permalink to &quot;一、总览：三个核心问题&quot;">​</a></h2><p>理解 LLM 及其衍生模型，重点回答三个问题：</p><ol><li><strong>神经网络到底在学习什么？</strong></li><li><strong>Transformer 如何把输入变成有用的表示？</strong></li><li><strong>LLM 如何通过训练学会生成文本？</strong></li></ol><p>这三个问题理解清楚后，再看 Qwen3-VL、VLA 和模型微调，就能把它们放进统一的框架里理解。</p><h3 id="全局知识地图" tabindex="-1">全局知识地图 <a class="header-anchor" href="#全局知识地图" aria-label="Permalink to &quot;全局知识地图&quot;">​</a></h3><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>┌─────────────────────────────────────────────────────────────┐</span></span>
<span class="line"><span>│  神经网络（学习函数 f_θ）                                    │</span></span>
<span class="line"><span>│      ↓  用 Transformer 作为骨干网络                          │</span></span>
<span class="line"><span>│  Transformer（逐层更新 Token 表示）                          │</span></span>
<span class="line"><span>│      ↓  加上 Tokenizer / Embedding / LM Head                 │</span></span>
<span class="line"><span>│  LLM（预测下一个 Token）                                     │</span></span>
<span class="line"><span>│      ↓  改变输入表示与监督目标                               │</span></span>
<span class="line"><span>│  VLM（+图像）  →  VLA（+图像+机器人状态，输出动作）          │</span></span>
<span class="line"><span>└─────────────────────────────────────────────────────────────┘</span></span></code></pre></div><hr><h2 id="二、神经网络-本质上是在学习一个函数" tabindex="-1">二、神经网络：本质上是在学习一个函数 <a class="header-anchor" href="#二、神经网络-本质上是在学习一个函数" aria-label="Permalink to &quot;二、神经网络：本质上是在学习一个函数&quot;">​</a></h2><h3 id="_2-1-函数抽象" tabindex="-1">2.1 函数抽象 <a class="header-anchor" href="#_2-1-函数抽象" aria-label="Permalink to &quot;2.1 函数抽象&quot;">​</a></h3><p>神经网络可以抽象为参数化函数：</p><p>[ y = f_\\theta(x) ]</p><table tabindex="0"><thead><tr><th>符号</th><th>含义</th></tr></thead><tbody><tr><td>(x)</td><td>输入，例如图像、文本特征或机器人状态</td></tr><tr><td>(y)</td><td>输出，例如分类结果、下一个 Token 的概率或机器人动作</td></tr><tr><td>(\\theta)</td><td>模型参数，包含各层权重和偏置</td></tr><tr><td>(f_\\theta)</td><td>由多层神经网络计算组成的函数</td></tr></tbody></table><p>最简单的线性层（以单个样本为例）：</p><p>[ y = Wx + b ]</p><p><strong>维度变化</strong>：</p><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>x : (in_dim,)         输入向量</span></span>
<span class="line"><span>W : (out_dim, in_dim) 权重矩阵</span></span>
<span class="line"><span>b : (out_dim,)        偏置</span></span>
<span class="line"><span>─────────────────────────────────</span></span>
<span class="line"><span>y = Wx + b : (out_dim,)   输出向量</span></span>
<span class="line"><span></span></span>
<span class="line"><span>批量形式：</span></span>
<span class="line"><span>x : (B, in_dim) ──▶ y : (B, out_dim)</span></span></code></pre></div><p>神经网络通过大量训练样本不断调整 (W)、(b) 及其他参数，使输出更符合目标。</p><h3 id="_2-2-训练的核心循环" tabindex="-1">2.2 训练的核心循环 <a class="header-anchor" href="#_2-2-训练的核心循环" aria-label="Permalink to &quot;2.2 训练的核心循环&quot;">​</a></h3><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>        ┌──────────────────────────────────────────┐</span></span>
<span class="line"><span>        │                                          │</span></span>
<span class="line"><span>        ▼                                          │</span></span>
<span class="line"><span>  ┌───────────┐   ┌───────────┐   ┌───────────┐   │</span></span>
<span class="line"><span>  │ 1. 输入数据│──▶│2. 前向计算 │──▶│ 3. 计算Loss│   │</span></span>
<span class="line"><span>  └───────────┘   └───────────┘   └───────────┘   │</span></span>
<span class="line"><span>                                        │          │</span></span>
<span class="line"><span>                                        ▼          │</span></span>
<span class="line"><span>                              ┌─────────────────┐  │</span></span>
<span class="line"><span>                              │4. 反向传播求梯度 │  │</span></span>
<span class="line"><span>                              │   + 优化器更新   │──┘</span></span>
<span class="line"><span>                              └─────────────────┘</span></span>
<span class="line"><span>                                  重复迭代</span></span></code></pre></div><ol><li><strong>输入数据</strong>：例如一段文本或一张图像</li><li><strong>前向计算</strong>：模型根据当前参数计算预测结果</li><li><strong>计算 Loss</strong>：衡量预测结果与训练目标的差距</li><li><strong>反向传播与参数更新</strong>：计算梯度，并用优化器更新参数</li></ol><p>重复以上过程，直到模型在目标任务上学得足够好。</p><h3 id="_2-3-两个关键概念的区别" tabindex="-1">2.3 两个关键概念的区别 <a class="header-anchor" href="#_2-3-两个关键概念的区别" aria-label="Permalink to &quot;2.3 两个关键概念的区别&quot;">​</a></h3><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>   Loss ──反向传播──▶ 梯度 ∇θ ──优化器──▶ 更新后的 θ</span></span>
<span class="line"><span>          （算梯度）            （用梯度更新）</span></span></code></pre></div><table tabindex="0"><thead><tr><th>概念</th><th>作用</th></tr></thead><tbody><tr><td><strong>反向传播（Backpropagation）</strong></td><td>计算每个参数应该如何影响 Loss，即计算梯度</td></tr><tr><td><strong>优化器（Optimizer）</strong></td><td>根据梯度实际更新参数，例如 SGD 或 AdamW</td></tr></tbody></table><blockquote><p><strong>核心结论</strong>：神经网络不是把正确答案存起来，而是通过训练调整参数，学习输入与输出之间的规律。对于后续的 VLA，这个规律可能是&quot;看到某种场景并收到某个指令时，机器人应该如何行动&quot;。</p></blockquote><hr><h2 id="三、transformer-把输入逐步变成上下文表示" tabindex="-1">三、Transformer：把输入逐步变成上下文表示 <a class="header-anchor" href="#三、transformer-把输入逐步变成上下文表示" aria-label="Permalink to &quot;三、Transformer：把输入逐步变成上下文表示&quot;">​</a></h2><h3 id="_3-1-从文本到输入张量" tabindex="-1">3.1 从文本到输入张量 <a class="header-anchor" href="#_3-1-从文本到输入张量" aria-label="Permalink to &quot;3.1 从文本到输入张量&quot;">​</a></h3><p>例如输入：</p><blockquote><p>机器人拿起杯子，然后把它放到桌子上。</p></blockquote><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>文本：&quot;机器人 拿起 杯子 ...&quot;</span></span>
<span class="line"><span>          │</span></span>
<span class="line"><span>          ▼  Tokenizer</span></span>
<span class="line"><span>   Token ID: [id_1, id_2, id_3, ...]       形状: (N,)</span></span>
<span class="line"><span>          │</span></span>
<span class="line"><span>          ▼  Embedding 查表</span></span>
<span class="line"><span>   X ∈ ℝ^(N×d)   ← N 个 Token，每个 d 维</span></span>
<span class="line"><span>          │      批量后: X ∈ ℝ^(B×N×d)</span></span>
<span class="line"><span>          ▼  （可选）+ 位置编码/位置信息</span></span>
<span class="line"><span>   X ∈ ℝ^(B×N×d)</span></span></code></pre></div><p><strong>关键张量形状</strong>：</p><table tabindex="0"><thead><tr><th>张量</th><th>形状</th><th>说明</th></tr></thead><tbody><tr><td>Token ID</td><td>((B, N))</td><td>每个元素是词表索引</td></tr><tr><td>Embedding 表</td><td>((V, d))</td><td>可学习参数</td></tr><tr><td>输入表示 (X)</td><td>((B, N, d))</td><td>每个 Token 一个 (d) 维向量</td></tr></tbody></table><h3 id="_3-2-decoder-layer-的两件事-含维度" tabindex="-1">3.2 Decoder Layer 的两件事（含维度） <a class="header-anchor" href="#_3-2-decoder-layer-的两件事-含维度" aria-label="Permalink to &quot;3.2 Decoder Layer 的两件事（含维度）&quot;">​</a></h3><p><strong>Self-Attention 内部的形状变化</strong>（单头视角，多头见后）：</p><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>输入 X : (B, N, d)</span></span>
<span class="line"><span>   │</span></span>
<span class="line"><span>   ├── W_Q, W_K, W_V 线性映射（各自 d×d）</span></span>
<span class="line"><span>   ▼</span></span>
<span class="line"><span>Q = XW_Q : (B, N, d)</span></span>
<span class="line"><span>K = XW_K : (B, N, d)</span></span>
<span class="line"><span>V = XW_V : (B, N, d)</span></span>
<span class="line"><span>   │</span></span>
<span class="line"><span>   ▼  QKᵀ / √d_k</span></span>
<span class="line"><span>注意力分数 : (B, N, N)      ← N×N 的注意力矩阵</span></span>
<span class="line"><span>   │</span></span>
<span class="line"><span>   ▼  加 Causal Mask + Softmax（沿最后一维）</span></span>
<span class="line"><span>注意力权重 : (B, N, N)</span></span>
<span class="line"><span>   │</span></span>
<span class="line"><span>   ▼  权重 × V</span></span>
<span class="line"><span>Attention 输出 : (B, N, d)</span></span>
<span class="line"><span>   │</span></span>
<span class="line"><span>   ▼  W_O 线性映射</span></span>
<span class="line"><span>Self-Attention 输出 : (B, N, d)</span></span></code></pre></div><p><strong>多头注意力（MHA）</strong>：把 (d) 拆成 (h) 个头，每头维度 (d_k = d/h)。</p><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>X : (B, N, d)</span></span>
<span class="line"><span>   │  拆头</span></span>
<span class="line"><span>   ▼</span></span>
<span class="line"><span>Q,K,V : (B, h, N, d_k)      每头独立算注意力</span></span>
<span class="line"><span>   │</span></span>
<span class="line"><span>   ▼  各头注意力</span></span>
<span class="line"><span>每头输出 : (B, h, N, d_k)</span></span>
<span class="line"><span>   │  拼头</span></span>
<span class="line"><span>   ▼</span></span>
<span class="line"><span>拼接 : (B, N, d)            h × d_k = d</span></span></code></pre></div><p><strong>FFN 内部的形状变化</strong>：先升维到 (d_{ff})（通常是 (4d)），再降回 (d)。</p><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>输入 : (B, N, d)</span></span>
<span class="line"><span>   │  W_1: (d_ff, d)，d_ff 通常 = 4d</span></span>
<span class="line"><span>   ▼</span></span>
<span class="line"><span>中间 : (B, N, d_ff)       例：d=4096 → d_ff=16384</span></span>
<span class="line"><span>   │  激活函数（GELU/SiLU）</span></span>
<span class="line"><span>   ▼</span></span>
<span class="line"><span>   │  W_2: (d, d_ff)</span></span>
<span class="line"><span>   ▼</span></span>
<span class="line"><span>输出 : (B, N, d)</span></span></code></pre></div><p><strong>一个 Decoder Layer 的完整数据流（含维度）</strong>：</p><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>        X_l  (B, N, d)</span></span>
<span class="line"><span>          │</span></span>
<span class="line"><span>          ├──────────────────────┐</span></span>
<span class="line"><span>          ▼                      │ 残差</span></span>
<span class="line"><span>   ┌─────────────┐               │</span></span>
<span class="line"><span>   │ Self-Attention│              │</span></span>
<span class="line"><span>   │  输出 (B,N,d) │              │</span></span>
<span class="line"><span>   └─────────────┘               │</span></span>
<span class="line"><span>          │                      │</span></span>
<span class="line"><span>          ▼                      │</span></span>
<span class="line"><span>        (+) ◀────────────────────┘</span></span>
<span class="line"><span>          │  (B, N, d)</span></span>
<span class="line"><span>          ▼  Norm</span></span>
<span class="line"><span>   ┌─────────────┐</span></span>
<span class="line"><span>   │     FFN      │  d → d_ff → d</span></span>
<span class="line"><span>   │  输出 (B,N,d) │</span></span>
<span class="line"><span>   └─────────────┘</span></span>
<span class="line"><span>          │</span></span>
<span class="line"><span>          ▼</span></span>
<span class="line"><span>        (+) ◀── 残差</span></span>
<span class="line"><span>          │  (B, N, d)</span></span>
<span class="line"><span>          ▼  Norm</span></span>
<span class="line"><span>        X_{l+1}  (B, N, d)</span></span></code></pre></div><blockquote><p><strong>关键观察</strong>：一个 Decoder Layer <strong>输入和输出的形状完全相同</strong>，都是 ((B, N, d))。这正是残差连接能成立、以及可以堆叠 (L) 层的前提。</p></blockquote><p>经过多层堆叠：</p><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>X_0 ──▶ Layer1 ──▶ X_1 ──▶ Layer2 ──▶ X_2 ──▶ ... ──▶ LayerL ──▶ X_L</span></span>
<span class="line"><span>(B,N,d)  (B,N,d)   (B,N,d)  (B,N,d)   (B,N,d)          (B,N,d)  (B,N,d)</span></span></code></pre></div><h3 id="_3-3-层级的直观理解" tabindex="-1">3.3 层级的直观理解 <a class="header-anchor" href="#_3-3-层级的直观理解" aria-label="Permalink to &quot;3.3 层级的直观理解&quot;">​</a></h3><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>浅层  ████░░░░░░░░  基础 Token 关系</span></span>
<span class="line"><span>中层  ████████░░░░  更复杂的上下文组合</span></span>
<span class="line"><span>深层  ████████████  有助于预测下一个 Token 的高层表示</span></span>
<span class="line"><span></span></span>
<span class="line"><span>（形状始终是 (B, N, d)，变化的是向量里承载的语义信息）</span></span></code></pre></div><table tabindex="0"><thead><tr><th>层级</th><th>作用（直观概括）</th></tr></thead><tbody><tr><td>浅层</td><td>学习和处理相对基础的 Token 关系</td></tr><tr><td>中间层</td><td>组合更复杂的上下文信息</td></tr><tr><td>深层</td><td>形成有助于预测下一个 Token 的高层表示</td></tr></tbody></table><blockquote><p>注意：这是帮助理解的概括，不代表每一层都严格对应某种固定语义。</p></blockquote><h3 id="_3-4-decoder-为什么需要-causal-mask" tabindex="-1">3.4 Decoder 为什么需要 Causal Mask？ <a class="header-anchor" href="#_3-4-decoder-为什么需要-causal-mask" aria-label="Permalink to &quot;3.4 Decoder 为什么需要 Causal Mask？&quot;">​</a></h3><p>在标准自回归 LLM 中，预测当前位置时不能看到未来 Token。</p><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>        Token:  机器人   拿起   杯子   [预测目标]</span></span>
<span class="line"><span>                  │       │      │</span></span>
<span class="line"><span>  机器人 可看:    ✓       ✗      ✗</span></span>
<span class="line"><span>  拿起   可看:    ✓       ✓      ✗</span></span>
<span class="line"><span>  杯子   可看:    ✓       ✓      ✓</span></span>
<span class="line"><span>  （✓ 可访问，✗ 被 Mask 屏蔽）</span></span>
<span class="line"><span></span></span>
<span class="line"><span>  注意力矩阵 (B, N, N) 示意（上三角被屏蔽为 -∞，Softmax 后为 0）：</span></span>
<span class="line"><span>        ┌─────────────┐</span></span>
<span class="line"><span>   机器人│ 1  0  0  0 │</span></span>
<span class="line"><span>   拿起  │ ✓  1  0  0 │</span></span>
<span class="line"><span>   杯子  │ ✓  ✓  1  0 │</span></span>
<span class="line"><span>   目标  │ ✓  ✓  ✓  1 │</span></span>
<span class="line"><span>        └─────────────┘</span></span></code></pre></div><blockquote><p>Mask 加在 Softmax 之前，形状为 ((B, N, N)) 或可广播的 ((1, 1, N, N))。适用范围说明：这里讨论的是标准自回归 Decoder-only LLM。编码器模型和部分多模态架构的注意力规则可能不同。</p></blockquote><hr><h2 id="四、llm-decoder-如何变成语言模型" tabindex="-1">四、LLM：Decoder 如何变成语言模型？ <a class="header-anchor" href="#四、llm-decoder-如何变成语言模型" aria-label="Permalink to &quot;四、LLM：Decoder 如何变成语言模型？&quot;">​</a></h2><h3 id="_4-1-完整结构抽象-含每层维度" tabindex="-1">4.1 完整结构抽象（含每层维度） <a class="header-anchor" href="#_4-1-完整结构抽象-含每层维度" aria-label="Permalink to &quot;4.1 完整结构抽象（含每层维度）&quot;">​</a></h3><p>以一次训练迭代为例（(B) 条样本，每条 (N) 个 Token）：</p><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>  文本输入（B 条，每条 N 个 Token）</span></span>
<span class="line"><span>     │</span></span>
<span class="line"><span>     ▼</span></span>
<span class="line"><span> ┌─────────┐</span></span>
<span class="line"><span> │Tokenizer│  文本 ↔ Token ID</span></span>
<span class="line"><span> └─────────┘</span></span>
<span class="line"><span>     │  Token ID : (B, N)        dtype=int</span></span>
<span class="line"><span>     ▼</span></span>
<span class="line"><span> ┌──────────────────────────┐</span></span>
<span class="line"><span> │Token Embedding + 位置信息 │  Token ID → 向量</span></span>
<span class="line"><span> └──────────────────────────┘</span></span>
<span class="line"><span>     │  Embedding: (B, N, d)</span></span>
<span class="line"><span>     │  + 位置信息: (B, N, d) 或位置编码加到 Attention 中</span></span>
<span class="line"><span>     ▼  X_0 : (B, N, d)</span></span>
<span class="line"><span> ┌──────────────────────────┐</span></span>
<span class="line"><span> │  Decoder Layer × L        │  每层: (B,N,d) → (B,N,d)</span></span>
<span class="line"><span> └──────────────────────────┘</span></span>
<span class="line"><span>     │  X_L : (B, N, d)</span></span>
<span class="line"><span>     ▼</span></span>
<span class="line"><span> ┌─────────┐</span></span>
<span class="line"><span> │ LM Head │  线性层 d → V</span></span>
<span class="line"><span> └─────────┘</span></span>
<span class="line"><span>     │  Logits : (B, N, V)</span></span>
<span class="line"><span>     ▼</span></span>
<span class="line"><span> ┌────────────────────┐</span></span>
<span class="line"><span> │Softmax / 解码策略   │  沿最后一维做 Softmax</span></span>
<span class="line"><span> └────────────────────┘</span></span>
<span class="line"><span>     │  概率 : (B, N, V)</span></span>
<span class="line"><span>     ▼</span></span>
<span class="line"><span>  每个位置选 Token</span></span></code></pre></div><table tabindex="0"><thead><tr><th>组件</th><th>输入形状</th><th>输出形状</th><th>说明</th></tr></thead><tbody><tr><td><strong>Tokenizer</strong></td><td>文本</td><td>((B, N))</td><td>Token ID</td></tr><tr><td><strong>Token Embedding</strong></td><td>((B, N))</td><td>((B, N, d))</td><td>查表 (V \\times d)</td></tr><tr><td><strong>位置信息</strong></td><td>—</td><td>((B, N, d))</td><td>加到 Embedding 上或注入 Attention</td></tr><tr><td><strong>Decoder Layer × L</strong></td><td>((B, N, d))</td><td>((B, N, d))</td><td>形状不变</td></tr><tr><td><strong>LM Head</strong></td><td>((B, N, d))</td><td>((B, N, V))</td><td>线性层 (d \\to V)</td></tr><tr><td><strong>Softmax</strong></td><td>((B, N, V))</td><td>((B, N, V))</td><td>沿 (V) 维归一化</td></tr></tbody></table><blockquote><p>说明：LM Head 对<strong>每个位置</strong>都输出一个词表分布，但训练和推理时通常只关心&quot;预测下一个 Token&quot;的位置（见 4.4）。</p></blockquote><h3 id="_4-2-llm-的输出是什么" tabindex="-1">4.2 LLM 的输出是什么？ <a class="header-anchor" href="#_4-2-llm-的输出是什么" aria-label="Permalink to &quot;4.2 LLM 的输出是什么？&quot;">​</a></h3><p>假设词表有 100,000 个 Token，取<strong>最后一个位置</strong>的隐藏向量：</p><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>X_L : (B, N, d)</span></span>
<span class="line"><span>        │  取最后一个位置（或每个位置都要）</span></span>
<span class="line"><span>        ▼</span></span>
<span class="line"><span>隐藏向量 h : (B, d)          （只看最后位置时）</span></span>
<span class="line"><span>        │  LM Head: W ∈ (V, d)</span></span>
<span class="line"><span>        ▼</span></span>
<span class="line"><span>Logits z : (B, V)            V = 100,000</span></span>
<span class="line"><span>        │  Softmax（沿 V 维）</span></span>
<span class="line"><span>        ▼</span></span>
<span class="line"><span>概率 P : (B, V)</span></span>
<span class="line"><span>        │  解码策略（贪心/采样）</span></span>
<span class="line"><span>        ▼</span></span>
<span class="line"><span>选出的 Token : (B,)</span></span></code></pre></div><p>若对<strong>所有位置</strong>都算：</p><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>Logits : (B, N, V)  →  Softmax  →  (B, N, V)</span></span></code></pre></div><p>示例（给定&quot;今天天气很&quot;）——以下数字仅用于说明机制，并非真实模型输出：</p><table tabindex="0"><thead><tr><th>候选 Token</th><th>概率</th></tr></thead><tbody><tr><td>好</td><td>0.55</td></tr><tr><td>冷</td><td>0.20</td></tr><tr><td>热</td><td>0.12</td></tr><tr><td>其他 Token</td><td>0.13</td></tr></tbody></table><blockquote><p>模型并不是直接输出整段话，而是先预测下一个 Token，再将生成的 Token 加入上下文，继续预测。这就是 <strong>Autoregressive Generation（自回归生成）</strong>。</p></blockquote><h3 id="_4-3-自回归生成示意" tabindex="-1">4.3 自回归生成示意 <a class="header-anchor" href="#_4-3-自回归生成示意" aria-label="Permalink to &quot;4.3 自回归生成示意&quot;">​</a></h3><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>&quot;今天天气很&quot; ──▶ 模型 ──▶ &quot;好&quot;</span></span>
<span class="line"><span>&quot;今天天气很好&quot; ──▶ 模型 ──▶ &quot;，&quot;</span></span>
<span class="line"><span>&quot;今天天气很好，&quot; ──▶ 模型 ──▶ &quot;适合&quot;</span></span>
<span class="line"><span>&quot;今天天气很好，适合&quot; ──▶ 模型 ──▶ ...</span></span>
<span class="line"><span>            （每步把新 Token 拼回输入，循环生成）</span></span>
<span class="line"><span></span></span>
<span class="line"><span>形状视角（单条样本，B=1）：</span></span>
<span class="line"><span>第1步：输入 (1, N)   → Logits (1, N, V)   → 取最后位置 → 选 1 个 Token</span></span>
<span class="line"><span>第2步：输入 (1, N+1) → Logits (1, N+1, V) → 取最后位置 → 选 1 个 Token</span></span>
<span class="line"><span>...</span></span>
<span class="line"><span>（N 每步 +1；实际实现常用 KV Cache 避免重复计算）</span></span></code></pre></div><h3 id="_4-4-llm-是怎么训练出来的" tabindex="-1">4.4 LLM 是怎么训练出来的？ <a class="header-anchor" href="#_4-4-llm-是怎么训练出来的" aria-label="Permalink to &quot;4.4 LLM 是怎么训练出来的？&quot;">​</a></h3><p>主流自回归 LLM 的基础预训练目标是 <strong>Next Token Prediction（下一个 Token 预测）</strong>。</p><p>假设训练文本是：<code>机器人 可以 抓取 杯子</code></p><p>构造的预测任务：</p><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>输入上下文            预测目标</span></span>
<span class="line"><span>────────────────────────────────</span></span>
<span class="line"><span>机器人          ──▶   可以</span></span>
<span class="line"><span>机器人 可以      ──▶   抓取</span></span>
<span class="line"><span>机器人 可以 抓取 ──▶   杯子</span></span></code></pre></div><blockquote><p>实际训练通常会并行计算多个位置的预测，而不需要逐个 Token 单独训练。</p></blockquote><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>一次前向，并行预测多个位置：</span></span>
<span class="line"><span>输入 Token:  [机器人] [可以] [抓取]     形状 (B, N)</span></span>
<span class="line"><span>                │        │       │</span></span>
<span class="line"><span>                ▼        ▼       ▼</span></span>
<span class="line"><span>Logits:        (B, N, V)  ← 每个位置都有 V 维分布</span></span>
<span class="line"><span>                │        │       │</span></span>
<span class="line"><span>目标 Token:    [可以]   [抓取]  [杯子]   形状 (B, N)</span></span>
<span class="line"><span>                │        │       │</span></span>
<span class="line"><span>                ▼        ▼       ▼</span></span>
<span class="line"><span>Loss:          L1   +   L2   +  L3   → 总 Loss（标量）</span></span>
<span class="line"><span>        （对每个位置算交叉熵，再求和/平均）</span></span></code></pre></div><p>对于目标 Token (x_t)，损失函数通常使用交叉熵：</p><p>[ \\mathcal{L} = -\\sum_t \\log P_\\theta(x_t \\mid x_{&lt;t}) ]</p><p><strong>张量视角</strong>：</p><table tabindex="0"><thead><tr><th>张量</th><th>形状</th><th>说明</th></tr></thead><tbody><tr><td>Logits</td><td>((B, N, V))</td><td>每个位置的词表分布</td></tr><tr><td>目标 Token</td><td>((B, N))</td><td>每个位置的正确答案</td></tr><tr><td>每位置 Loss</td><td>((B, N))</td><td>交叉熵逐位置计算</td></tr><tr><td>总 Loss</td><td>标量 <code>()</code></td><td>求和或平均后用于反向传播</td></tr></tbody></table><p>含义：</p><ul><li>正确 Token 的预测概率越高，Loss 越小</li><li>正确 Token 的预测概率越低，Loss 越大</li><li>反向传播根据 Loss 计算梯度，再由优化器更新参数</li></ul><p>重复大量训练之后，模型会逐步学习语言结构、词语关系、事实关联以及一些可以通过文本训练获得的推理模式。</p><blockquote><p><strong>注意</strong>：预测下一个 Token 是训练目标，不等于模型只会机械地续写，也不意味着模型一定掌握了真实世界中的因果规律。</p></blockquote><hr><h2 id="五、预训练、sft-和推理-三个不同阶段" tabindex="-1">五、预训练、SFT 和推理：三个不同阶段 <a class="header-anchor" href="#五、预训练、sft-和推理-三个不同阶段" aria-label="Permalink to &quot;五、预训练、SFT 和推理：三个不同阶段&quot;">​</a></h2><p>这是后续学习模型微调时必须分清的概念。</p><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>┌──────────────┐    ┌──────────────┐    ┌──────────────┐</span></span>
<span class="line"><span>│   预训练      │───▶│     SFT      │───▶│    推理       │</span></span>
<span class="line"><span>│ Pretraining  │    │ 监督微调      │    │  Inference   │</span></span>
<span class="line"><span>├──────────────┤    ├──────────────┤    ├──────────────┤</span></span>
<span class="line"><span>│大量文本       │    │指令+高质量回答│    │固定参数       │</span></span>
<span class="line"><span>│Next Token预测 │    │学会遵循指令   │    │输入→生成Token │</span></span>
<span class="line"><span>│参数大幅更新   │    │参数微调       │    │参数不更新     │</span></span>
<span class="line"><span>└──────────────┘    └──────────────┘    └──────────────┘</span></span>
<span class="line"><span>   学会&quot;语言&quot;         学会&quot;听话&quot;          实际使用</span></span></code></pre></div><table tabindex="0"><thead><tr><th>阶段</th><th>目标</th><th>典型过程</th><th>维度视角</th></tr></thead><tbody><tr><td><strong>预训练（Pretraining）</strong></td><td>使用大量文本进行下一个 Token 预测，让模型学习通用语言表示和知识</td><td>Next Token Prediction</td><td>Logits ((B,N,V)) vs 目标 ((B,N)) 算交叉熵</td></tr><tr><td><strong>监督微调（SFT）</strong></td><td>使用指令和高质量回答训练模型，让它学会按照要求回答问题、遵循指令或调用工具</td><td>提高目标回答中 Token 的预测概率</td><td>同样 ((B,N,V))，但只在回答位置算 Loss</td></tr><tr><td><strong>推理（Inference）</strong></td><td>固定训练好的参数，输入提示词，逐步生成 Token；一般不会在每次回答时更新模型参数</td><td>输入 → 前向计算 → 选择 Token → 继续生成</td><td>每步输入 ((B,N))，取最后位置 ((B,V)) 选 Token</td></tr></tbody></table><h3 id="sft-的损失计算范围-含-mask" tabindex="-1">SFT 的损失计算范围（含 Mask） <a class="header-anchor" href="#sft-的损失计算范围-含-mask" aria-label="Permalink to &quot;SFT 的损失计算范围（含 Mask）&quot;">​</a></h3><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>样本：[指令/提示词部分] [回答部分]</span></span>
<span class="line"><span>        │                  │</span></span>
<span class="line"><span>        ▼                  ▼</span></span>
<span class="line"><span>    不计算 Loss        计算 Loss  ◀── SFT 常只监督回答部分</span></span>
<span class="line"><span></span></span>
<span class="line"><span>形状视角：</span></span>
<span class="line"><span>  Logits : (B, N, V)</span></span>
<span class="line"><span>  目标   : (B, N)</span></span>
<span class="line"><span>  Loss Mask : (B, N)  —— 提示词位置=0，回答位置=1</span></span>
<span class="line"><span>  有效 Loss = Σ(逐位置 Loss × Mask) / Σ(Mask)</span></span></code></pre></div><blockquote><p>预训练和 SFT 都可以使用相似的交叉熵损失，但训练数据、监督方式和优化目标侧重点不同。SFT 常常只对回答部分计算损失，而不对全部提示词计算损失。</p></blockquote><hr><h2 id="六、把这些原理连接到-vlm-和-vla" tabindex="-1">六、把这些原理连接到 VLM 和 VLA <a class="header-anchor" href="#六、把这些原理连接到-vlm-和-vla" aria-label="Permalink to &quot;六、把这些原理连接到 VLM 和 VLA&quot;">​</a></h2><h3 id="_6-1-三类模型的结构对比-含维度" tabindex="-1">6.1 三类模型的结构对比（含维度） <a class="header-anchor" href="#_6-1-三类模型的结构对比-含维度" aria-label="Permalink to &quot;6.1 三类模型的结构对比（含维度）&quot;">​</a></h3><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>【普通 LLM】</span></span>
<span class="line"><span>  文本 Token (B,N) ──▶ Embedding (B,N,d) ──▶ Decoder (B,N,d)</span></span>
<span class="line"><span>                    ──▶ LM Head (B,N,V) ──▶ 下一个 Token</span></span>
<span class="line"><span></span></span>
<span class="line"><span>【VLM 视觉语言模型】</span></span>
<span class="line"><span>  图像 (B,3,H,W) ──▶ Vision Encoder ──▶ 视觉特征 (B,N_v,d)</span></span>
<span class="line"><span>                                          │</span></span>
<span class="line"><span>  文本 (B,N_t) ──▶ Token Embedding (B,N_t,d)</span></span>
<span class="line"><span>                                          │</span></span>
<span class="line"><span>                    拼接/融合: (B, N_v+N_t, d)</span></span>
<span class="line"><span>                                          │</span></span>
<span class="line"><span>                    ──▶ LLM Backbone ──▶ LM Head (B,N,V) ──▶ 文本回答</span></span>
<span class="line"><span></span></span>
<span class="line"><span>【VLA 视觉语言动作模型】</span></span>
<span class="line"><span>  图像 (B,3,H,W) ─┐</span></span>
<span class="line"><span>  指令 (B,N_t)   ─┼──▶ 多模态 Backbone ──▶ 特征 (B,·,d)</span></span>
<span class="line"><span>  状态 (B,d_s)   ─┘                          │</span></span>
<span class="line"><span>                                             ▼</span></span>
<span class="line"><span>                              动作预测模块 ──▶ 动作 (B, T_a, d_a)</span></span></code></pre></div><table tabindex="0"><thead><tr><th>模型类型</th><th>输入形状</th><th>核心结构</th><th>输出形状</th></tr></thead><tbody><tr><td><strong>普通 LLM</strong></td><td>文本 ((B,N))</td><td>Decoder Backbone</td><td>((B,N,V)) → 下一个 Token</td></tr><tr><td><strong>VLM（视觉语言模型）</strong></td><td>图像 ((B,3,H,W)) + 文本 ((B,N_t))</td><td>Vision Encoder + 融合 + LLM Backbone</td><td>((B,N,V)) 文本回答</td></tr><tr><td><strong>VLA（视觉语言动作模型）</strong></td><td>图像 + 指令 + 状态</td><td>多模态 Backbone + 动作预测模块</td><td>((B,T_a,d_a)) 动作或动作序列</td></tr></tbody></table><blockquote><p>符号说明：(N_v) = 视觉 Token 数，(N_t) = 文本 Token 数，(d_s) = 状态维度，(T_a) = 动作序列长度，(d_a) = 动作维度。各模型具体实现中维度名称可能不同，但&quot;输入扩展、输出改变、骨干形状保持 ((B,N,d))&quot;这一规律普遍成立。</p></blockquote><blockquote><p><strong>核心区别</strong>：它们之间最核心的区别不是 Transformer 是否相同，而是<strong>输入表示、输出空间和训练监督目标</strong>发生了变化。</p><ul><li>LLM：主要学习文本 Token 的预测</li><li>VLM：引入图像表示，学习视觉与语言之间的关联</li><li>VLA：进一步学习视觉、语言、机器人状态与动作之间的对应关系</li></ul></blockquote><h3 id="_6-2-vla-的训练样本-含维度" tabindex="-1">6.2 VLA 的训练样本（含维度） <a class="header-anchor" href="#_6-2-vla-的训练样本-含维度" aria-label="Permalink to &quot;6.2 VLA 的训练样本（含维度）&quot;">​</a></h3><p>VLA 的训练样本可以表示为：</p><p>[ (I_t, L, s_t) \\longrightarrow A_t ]</p><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>      输入（多模态）                              输出</span></span>
<span class="line"><span>┌────────────────────────────┐          ┌──────────────────┐</span></span>
<span class="line"><span>│ I_t  当前图像 (B,3,H,W)      │          │                  │</span></span>
<span class="line"><span>│ L    指令 (B,N_t)            │──模型──▶│ A_t 动作 (B,T_a,d_a)│</span></span>
<span class="line"><span>│ s_t  状态 (B,d_s)            │          │ 或动作序列        │</span></span>
<span class="line"><span>└────────────────────────────┘          └──────────────────┘</span></span></code></pre></div><table tabindex="0"><thead><tr><th>符号</th><th>含义</th><th>典型形状</th></tr></thead><tbody><tr><td>(I_t)</td><td>当前图像</td><td>((B, 3, H, W))</td></tr><tr><td>(L)</td><td>自然语言指令</td><td>((B, N_t))</td></tr><tr><td>(s_t)</td><td>机器人状态</td><td>((B, d_s))</td></tr><tr><td>(A_t)</td><td>目标动作或动作序列</td><td>((B, T_a, d_a)) 或 ((B, d_a))</td></tr></tbody></table><p>此时，训练损失不一定是文本 Token 的交叉熵，也可能是：</p><ul><li>动作回归损失（如 MSE，作用于 ((B,T_a,d_a))）</li><li>Diffusion 损失</li><li>Flow Matching 损失</li></ul><blockquote><p>前面学到的神经网络训练循环仍然成立，只是<strong>预测对象和损失函数变了</strong>。</p></blockquote><h3 id="_6-3-统一视角-变的只是输入-输出-损失" tabindex="-1">6.3 统一视角：变的只是输入/输出/损失 <a class="header-anchor" href="#_6-3-统一视角-变的只是输入-输出-损失" aria-label="Permalink to &quot;6.3 统一视角：变的只是输入/输出/损失&quot;">​</a></h3><div class="language- vp-adaptive-theme"><button title="Copy Code" class="copy"></button><span class="lang"></span><pre class="shiki shiki-themes github-light github-dark vp-code" tabindex="0"><code><span class="line"><span>             输入表示          骨干计算        输出空间          损失函数</span></span>
<span class="line"><span>LLM    │  文本 (B,N)     │  Transformer  │  (B,N,V) 词表分布 │  交叉熵</span></span>
<span class="line"><span>VLM    │  图像+文本       │  Transformer  │  (B,N,V) 词表分布 │  交叉熵</span></span>
<span class="line"><span>VLA    │  图像+指令+状态   │  Transformer  │  (B,T_a,d_a) 动作 │  回归/Diffusion/Flow</span></span>
<span class="line"><span>        └─────────────────┴───────────────┴──────────────────┴──────────┘</span></span>
<span class="line"><span>              （变化）        （形状不变）      （变化）          （变化）</span></span></code></pre></div><hr><h2 id="七、本阶段需要掌握的结论" tabindex="-1">七、本阶段需要掌握的结论 <a class="header-anchor" href="#七、本阶段需要掌握的结论" aria-label="Permalink to &quot;七、本阶段需要掌握的结论&quot;">​</a></h2><ol><li><strong>神经网络</strong>：通过 Loss、梯度和优化器学习参数化函数。</li><li><strong>Transformer</strong>：通过多层 Attention 和 FFN，逐步更新上下文表示；<strong>每层输入输出形状均为 ((B,N,d))</strong>，这是可堆叠的关键。</li><li><strong>LLM</strong>：通过 LM Head 将隐藏表示 ((B,N,d)) 映射为词表上的预测分布 ((B,N,V))，主流自回归模型使用下一个 Token 预测进行预训练。</li><li><strong>微调</strong>：改变训练数据与监督目标（如 SFT 用 Loss Mask 只监督回答部分），让模型适应特定任务。</li><li><strong>VLA</strong>：沿用神经网络与 Transformer 的基本计算机制，但把输入扩展到视觉和机器人状态，把输出扩展到机器人动作。</li></ol><h3 id="关键张量形状速查表" tabindex="-1">关键张量形状速查表 <a class="header-anchor" href="#关键张量形状速查表" aria-label="Permalink to &quot;关键张量形状速查表&quot;">​</a></h3><table tabindex="0"><thead><tr><th>阶段</th><th>张量</th><th>形状</th></tr></thead><tbody><tr><td>输入</td><td>Token ID</td><td>((B, N))</td></tr><tr><td>Embedding</td><td>(X_0)</td><td>((B, N, d))</td></tr><tr><td>Attention</td><td>Q/K/V</td><td>((B, h, N, d_k))</td></tr><tr><td>Attention</td><td>注意力分数/权重</td><td>((B, h, N, N))</td></tr><tr><td>Attention</td><td>输出</td><td>((B, N, d))</td></tr><tr><td>FFN</td><td>中间层</td><td>((B, N, d_{ff}))，(d_{ff}\\approx 4d)</td></tr><tr><td>Decoder 每层</td><td>输入=输出</td><td>((B, N, d))</td></tr><tr><td>LM Head</td><td>Logits</td><td>((B, N, V))</td></tr><tr><td>训练</td><td>目标 Token</td><td>((B, N))</td></tr><tr><td>训练</td><td>总 Loss</td><td>标量 <code>()</code></td></tr><tr><td>推理</td><td>每步取最后位置</td><td>((B, V))</td></tr></tbody></table><hr>`,118)])])}const g=a(e,[["render",l]]);export{b as __pageData,g as default};
