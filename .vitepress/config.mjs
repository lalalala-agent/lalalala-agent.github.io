import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(defineConfig({
  lang: 'zh-CN',
  title: '个人知识库',
  description: '端侧 LLM 部署与智能体设计知识库',
  srcDir: '笔记',
  outDir: 'docs',
  cleanUrls: true,
  lastUpdated: true,

  markdown: {
    mermaid: true,
  },

  vite: {
    optimizeDeps: {
      include: ['mermaid', 'fastdom'],
    },
  },

  themeConfig: {
    nav: [
      { text: 'LLM 推理', link: '/LLM推理/' },
      { text: 'LLM 训练', link: '/LLM训练/' },
      { text: '智能体设计', link: '/agent设计/' },
      { text: '语音交互', link: '/语音交互/' },
    ],

    sidebar: [
      {
        text: 'LLM 推理',
        link: '/LLM推理/',
        items: [
          { text: 'vLLM 推理', link: '/LLM推理/vLLM推理' },
          { text: 'KV 缓存与前缀缓存', link: '/LLM推理/KV缓存与前缀缓存' },
          { text: 'Qwen3.5-4090 性能', link: '/LLM推理/Qwen3.5-4090性能' },
          { text: 'RK3588 硬件', link: '/LLM推理/RK3588硬件' },
          { text: 'RK3588 模型打包', link: '/LLM推理/RK3588模型打包' },
          { text: 'Qwen3-VL 端侧性能', link: '/LLM推理/Qwen3-VL端侧性能' },
        ],
      },
      {
        text: 'LLM 训练',
        link: '/LLM训练/',
        items: [
          { text: 'BERT 微调', link: '/LLM训练/BERT微调' },
          { text: 'LoRA 微调', link: '/LLM训练/LoRA微调' },
        ],
      },
      {
        text: '智能体设计',
        link: '/agent设计/',
        items: [
          { text: '智能体架构', link: '/agent设计/OpenClaw智能体架构' },
          { text: '身份与系统提示词', link: '/agent设计/OpenClaw系统提示词' },
          { text: '工具与技能', link: '/agent设计/OpenClaw工具与技能' },
          { text: '记忆系统', link: '/agent设计/OpenClaw记忆系统' },
          { text: '上下文工程', link: '/agent设计/OpenClaw上下文工程' },
          { text: '定时与主动运行', link: '/agent设计/OpenClaw定时与主动运行' },
          { text: 'LangGraph 流式输出', link: '/agent设计/LangGraph流式输出' },
          { text: '多机器人运行时', link: '/agent设计/LangGraph+FastAPI多机器人设计' },
          { text: '规划与执行', link: '/agent设计/LangGraph规划和执行' },
        ],
      },
      {
        text: '语音交互',
        link: '/语音交互/',
        items: [
          { text: '编写引导', link: '/语音交互/' },
        ],
      },
    ],

    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: '搜索', placeholder: '搜索文档' },
          modal: {
            noResultsText: '未找到相关结果',
            resetButtonTitle: '清除查询',
            footer: { selectText: '选择', navigateText: '切换', closeText: '关闭' },
          },
        },
      },
    },

    outline: { level: [2, 3], label: '本页目录' },
    docFooter: { prev: '上一篇', next: '下一篇' },
    lastUpdated: { text: '更新于' },
    returnToTopLabel: '回到顶部',
    sidebarMenuLabel: '目录',
    darkModeSwitchLabel: '主题',
    lightModeSwitchTitle: '切换到浅色模式',
    darkModeSwitchTitle: '切换到深色模式',
    socialLinks: [
      { icon: 'github', link: 'https://github.com/lalalala-agent/lalalala-agent.github.io' },
    ],
  },
}))
