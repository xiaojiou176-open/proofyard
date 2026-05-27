# Proofyard 中文入口

这个页面只做一件事：帮中文读者快速理解英文主文档，不和英文 canonical public mainline 抢主线。

## 先看哪里

1. 英文首页：`README.md`
2. 英文文档导航：`docs/index.md`
3. 首跑指南：`docs/getting-started/human-first-10-min.md`

## 当前主线

- 对外唯一主线：`just run`
- 直接命令：`pnpm uiq run --profile pr --target web.local`
- `just run-legacy` 只是 helper path，不是默认公开主线

## 你跑完后看什么

先看 `.runtime-cache/artifacts/runs/<runId>/manifest.json`，再看
`docs/reference/run-evidence-example.md`。
