<p align="center">
  <img src="https://em-content.zobj.net/source/apple/391/magnifying-glass-tilted-left_1f50d.png" width="120" alt="magnifying glass" />
</p>

<h1 align="center">proofyard</h1>

<p align="center">
  <strong>every claim ships with its receipt</strong>
</p>

<p align="center">
  <a href="https://github.com/xiaojiou176-open/proofyard/stargazers"><img src="https://img.shields.io/github/stars/xiaojiou176-open/proofyard?style=flat&color=yellow" alt="Stars"></a>
  <a href="https://github.com/xiaojiou176-open/proofyard/commits/main"><img src="https://img.shields.io/github/last-commit/xiaojiou176-open/proofyard?style=flat" alt="Last Commit"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/xiaojiou176-open/proofyard?style=flat" alt="License"></a>
</p>

<p align="center">
  <a href="#what-you-get">What You Get</a> •
  <a href="#install">Install</a> •
  <a href="#how-it-work">How It Work</a> •
  <a href="#ecosystem">Ecosystem</a>
</p>

---

proofyard turns long, messy AI outputs into auditable workflows. Every step gets a hash, every claim gets a source, every replay matches byte-for-byte.

```
┌──────────────────────────────────────┐
│  LOCAL-FIRST          ████████ 100%  │
│  SOURCE-TRACEABLE     ████████ 100%  │
│  TYPING REQUIRED      ░░░░░░░░   0%  │
│  VIBES                ████████ ZERO  │
│                                FILLER│
└──────────────────────────────────────┘
```

> Evidence-first workbench. Trace, hash, replay, prove.

## What You Get

| Surface | What |
|---|---|
| `proofyard apps` | Workshop, quick-launch, task center. Authored output, traced. |
| `packages` | Shared evidence primitives — hashing, tracing, snapshotting. |
| `mcp skills` | Hand a flow to any agent. Get a flow plus the receipt. |
| `contracts` | Versioned proof schemas. Diffable. Replayable. |
| `e2e tests` | Cross-surface integration. The receipts run too. |

> [!IMPORTANT]
> Local-first by default. No silent telemetry. No cloud round-trip. Your data stays on your machine until you explicitly ship it somewhere.

## Install

```bash
git clone https://github.com/xiaojiou176-open/proofyard.git
cd proofyard
# follow the per-stack quickstart in INSTALL.md or docs/
```

Three commands. No `curl | sh`. No login. Read what you run.

Install break? Open your favorite agent and say *"Read AGENTS.md and bootstrap proofyard for me."* Agent fix own brain. Long version: [`docs/`](./docs/).

## How It Work

The repo is seven layers — exactly the seven commits in `git log`. New work goes in as small named PRs. No 50-file mystery commits.

| Layer | What |
|---|---|
| `chore: scaffold` | License, governance, hygiene gates, CI scaffolding. |
| `feat(core)` | The primary engine. The reason proofyard exists. |
| `feat(modules)` | Packages, adapters, services, plugins. The second floor. |
| `feat(contracts)` | Schemas, configs, public boundaries. Other code talks here. |
| `test:` | Receipts. Everything in this layer must run. |
| `feat(ops)` | Scripts, infra, CI helpers, build glue. |
| `docs:` | Public docs surface. The pretty face. |

`git log` reads like a building floor plan. Look once, know the whole shape.

## Ecosystem

proofyard lives in the **yard family**: seven yards. one philosophy: structured input, structured output, structured proof.

| Repo | What |
|---|---|
| [**switchyard**](https://github.com/xiaojiou176-open/switchyard) | model & agent runtime switch board |
| [**browserclickyard**](https://github.com/xiaojiou176-open/browserclickyard) | your AI clicks, your browser obeys |
| [**noteyard**](https://github.com/xiaojiou176-open/noteyard) | your Apple Notes never really die |
| [**dealyard**](https://github.com/xiaojiou176-open/dealyard) | let prices fight, you sit and watch |
| [**docyard**](https://github.com/xiaojiou176-open/docyard) | docs site in, markdown out, no scraping by hand |
| [**fileyard**](https://github.com/xiaojiou176-open/fileyard) | messy folders in, organized library out |
| [**proofyard**](https://github.com/xiaojiou176-open/proofyard) *(you here)* | every claim ships with its receipt |

Cross-family taste:
[**BeamMe**](https://github.com/xiaojiou176-open/BeamMe) ·
[**BrewMe**](https://github.com/xiaojiou176-open/BrewMe) ·
[**OpenVibeCoding**](https://github.com/xiaojiou176-open/OpenVibeCoding) ·
[**proofyard**](https://github.com/xiaojiou176-open/proofyard).

## Star This Repo

If proofyard saves you a click, an hour, or a headache — star costs zero. Fair trade. ⭐

[![Star History Chart](https://api.star-history.com/svg?repos=xiaojiou176-open/proofyard&type=Date)](https://star-history.com/#xiaojiou176-open/proofyard&Date)

## Also by Yifeng[Terry] Yu

- **[switchyard](https://github.com/xiaojiou176-open/switchyard)** — model & agent runtime switch board
- **[browserclickyard](https://github.com/xiaojiou176-open/browserclickyard)** — your AI clicks, your browser obeys
- **[BeamMe](https://github.com/xiaojiou176-open/BeamMe)** — beam your agent config to any planet
- **[BrewMe](https://github.com/xiaojiou176-open/BrewMe)** — wake up, news already brewed
- **[OpenVibeCoding](https://github.com/xiaojiou176-open/OpenVibeCoding)** — AI codes overnight, you ship in the morning

## License

MIT — small print, big freedom.
