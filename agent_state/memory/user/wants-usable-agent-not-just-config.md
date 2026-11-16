---
name: wants-usable-agent-not-just-config
description: 让用户配置某个智能体时，他要的是一个能直接打开就用的交互界面，不只是写好的配置文件
updated_at: 2026-11-08
---

用户把一份角色设定交给我初始化智能体时，我第一轮只写了 `AGENTS.md` 与 `system_config.yaml`，
他随即回过来：「我希望你能够直接做一个我可以交互使用的智能体」。

**Why:** 他要的是可以立刻上手操作的东西，配置文件对他是半成品。

**How to apply:** 接到「把某个智能体做成这样」的需求时，除了配置，默认再多做一步交互界面 ——
在这个项目里就是该 Agent 自己的 workbench（见 `penguin-plugin` 技能），并把它跑通、验证过再交付；
不要停在「新开一个对话就能用」这种交代上。
