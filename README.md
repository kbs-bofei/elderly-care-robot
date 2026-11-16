# 小暖 · 去平台化最小原型

把原本跑在 PenguinHarness 上的「小暖」老年陪伴智能体，迁到一个**零第三方依赖**的 Node.js 运行时上。人格、记忆、技能、Hook 全部保留，只替换了平台提供的运行时层。

## 目录结构

```
xiaonuan-agent/
├── agent_state/
│   ├── AGENTS.md              # 人格与行为规则（已改掉 .penguin 硬编码路径）
│   ├── system_prompt.md       # 通用 system prompt（含 {{占位符}}）
│   ├── memory/user/           # 三级记忆（原样保留）
│   ├── skills/                # 25 项技能（原样保留）
│   ├── hooks/local-time/      # 时间 Hook（原 .mjs 脚本直接复用）
│   ├── hooks/goal/            # 目标模式 Hook（备用，暂未接线）
│   └── media-library/         # 回忆库（占位，见"后续接入"）
├── runtime/
│   ├── server.mjs             # HTTP 服务 + SSE 流式接口
│   ├── agent.mjs              # Agent 循环：LLM 调用 + 工具调用
│   ├── prompt.mjs             # 拼装 system prompt（替代模板注入）
│   └── tools.mjs              # 4 个内置工具（替代 Harness 工具）
├── public/                    # 零依赖 Web 聊天界面
├── config.json                # API 配置（填这里）
└── package.json
```

## 快速开始

需要 Node.js 18+（已在 v22 验证）。无需 `npm install`。

1. 编辑 `config.json`，填入你的 API 信息。任意 **OpenAI 兼容** 的服务都可以：

   ```json
   {
     "LLM_BASE_URL": "https://api.openai.com/v1",
     "LLM_API_KEY": "sk-你的密钥",
     "LLM_MODEL": "gpt-4o-mini"
   }
   ```

   当前配置使用**词元跳动 TokenDance**（`https://tokendance.space/gateway/v1`，模型 `deepseek-v4.1-flash`）——一个聚合多家大模型的 API 网关，密钥在其控制台 https://tokendance.space/keys 创建。注意模型需在密钥授权列表内（可用 `/v1/models` 查询），否则报 403「无权访问模型」。

   其他可选：DeepSeek（`https://api.deepseek.com/v1`，`deepseek-chat`）、通义、智谱，或本地 Ollama（`http://localhost:11434/v1`）。也可用环境变量 `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` 覆盖（环境变量优先）。

2. 启动：

   ```bash
   npm start
   # 或 node runtime/server.mjs
   ```

3. 浏览器打开 `http://127.0.0.1:8787`。端口可用 `PORT` 环境变量修改。

## 已实现的能力

- **流式对话**：SSE 逐字输出，界面实时显示
- **Agent 循环**：最多 8 轮工具调用，自动把工具结果回灌给模型
- **知识图谱**：`query_graph` 查人物关系/称呼/作息/病史/纪念日，数据存 `agent_state/knowledge/graph.json`，谈及相关话题时模型会主动查
- **三级记忆写入**：`save_memory` 支持 confirmed/candidate/care，一条事实一个文件带 frontmatter，自动更新 `MEMORY.md` 索引
- **回忆相册**：侧栏「回忆相册」是真实页面，读 `media-library/index.json` 展示照片卡片，可点击放大；对话里出现 `〔照片：xxx〕` 也会变成可点的照片按钮
- **7 个工具**：上面三个 + `read_file`（含图片 base64）、`write_file`、`list_files`、`exec_command`，全部限制在项目目录内且拦截破坏性命令
- **提示词拼装**：把人格、记忆索引、技能元数据、口语化时间拼进 system prompt，无平台占位符残留
- **Hook 复用**：`local-time/time.mjs` 原样调用，每条消息注入"晚上八点三十二分"这类口语时间
- **多轮记忆**：会话历史按 sessionId 保存在内存
- **适老界面**：字号大、按钮大、有快捷提问；工具调用对开发者可见

> 示例图谱和 3 张 SVG 回忆照片都是占位数据，替换 `graph.json` 与 `media-library/` 里的内容即可换成真实的长辈资料。

## 与原平台的对应关系

| 原 PenguinHarness | 本原型 |
|---|---|
| `system_config.yaml` 的 system_prompt | `agent_state/system_prompt.md` |
| `{{AGENTS_MD}}/{{MEMORY}}/{{SKILLS}}` 注入 | `runtime/prompt.mjs` |
| 内置 read/edit/write/exec 工具 | `runtime/tools.mjs` |
| Agent 循环 / 模型调用 | `runtime/agent.mjs` |
| Workbench 插件界面 | `public/` 静态页面 |
| local-time hook | 直接调用原 `.mjs` 脚本 |
| Vault 密钥 | `config.json` / 环境变量 |

## 还没接的部分（需要真实环境）

1. **设备联动**：打电话、家电、音乐、提醒需要真实网关。建议用 **MCP Server** 暴露这些能力，在 `tools.mjs` 里桥接，或让 runtime 支持加载 MCP 工具。
2. **语音**：肩戴设备的中文 ASR/TTS 未接（如 Whisper / Edge TTS），当前是文字对话。
3. **goal Hook**：`hooks/goal/` 的停止钩子未接线。可在 `agent.mjs` 每轮结束后调用 `stop.mjs` 判断是否继续。
4. **Vault / 定时**：密钥建议改用环境变量或密钥管理；定时提醒可用系统 cron / 计划任务。
5. **知识审核服务**：候选记忆求证后`上报记忆审核服务`这一步，原型只做了本地 `tier` 变更，没有对接外部审核端。

## 验证记录

已通过：
- 全部 JS 语法检查 + JSON 校验
- 提示词拼装（人格/记忆/技能/口语时间均注入、无残留占位符）
- HTTP 接口：health、config、media（3 张照片）、图片静态服务（image/svg+xml，200）
- 工具层：query_graph 按关键词检索（孙女/降压药均命中）、save_memory 写入 frontmatter + 更新索引、read_media_index
- 端到端 Agent 循环（mock LLM）：模型发起 `query_graph("孙女")` → 图谱命中 → 流式回复，全程通过
- **真实 LLM 端到端（词元跳动 deepseek-v4.1-flash）**：已用真实 Key 验证两条——①「我孙女叫什么」→ 自动调用 `query_graph` → 命中"小雨"→ 流式回复并引导看照片；②「我今天有点闷」→ 称呼"奶奶"、短句、主动提议听《天仙配》。工具调用与人格设定均正常
- 修复配置加载时序 bug：`server.mjs` 原先静态 import agent.mjs，导致 agent 顶层读取 `LLM_*` 时 config.json 尚未加载而拿到空值（报 `fetch failed`）。已改为在加载 config 后动态 import

真实对话需填入有效 API Key 后验证。
