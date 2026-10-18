# @dsh-fly/dsh-plugin-fly-engagement

DSH Fly 的 **engagement 记录面**（Security / CTF 作战室的"把发现沉淀下来"那一半）：

- **agent 平面**（`tools/index.js`，由 Fly preset 按会话挂载）：`eng_record`（goal/facts/findings/assets/edges，
  漏洞**必须带复现步骤**）、`eng_state`（投影 + `counts`/`dropped`/`refused`/`truncated`）、
  `eng_report`（全量 Markdown 报告）。
- **宿主平面**（根 `index.js`，`inject: ['webServer','shell']`）：`GET /fly/engagement/state|report`，
  给抽屉面板取数；两半共用 `lib/fold.mjs` 的投影口径 ⇒ 面板读数与 `eng_state` 永远同口径。

存储：`<workspace>/.fly-engagement/events.jsonl`（append-only，投影 = fold）。
**不写任何自定义会话事件**（DSH 毒药条）；文件读写全走 `ctx.shell` 接缝。

借鉴 `@howmp/dsh-pentest`（MIT）的数据形状（六表 + 带词汇的边 + 必填步骤 + 双计数 + 确定性 id），
承载面用 DSH Fly 自己的抽屉面板。设计与验收见 dsh-fly 仓 `docs/security-mode-review-and-plan.md` §11。

## 形状（与 fly-smart 同一条：一个包、两种挂载）

| 挂载点 | 文件 | 干什么 |
| --- | --- | --- |
| 宿主行（bundle patch，**裸包名**） | `index.js` | 端点 + 客户端半边（客户端半边要求行名是裸包名，带 `/` 不会被登记） |
| agent 行（preset 指向子路径） | `tools/index.js` | 三个 `eng_*` 工具 |

## 门禁

```bash
node scripts/verify.mjs      # 包内测试 + 静态钉子（毒药条 / shell 接缝 / 裸包名 / dsh.client）
```
