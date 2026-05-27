import type { AppLocale, TranslationValues } from "./types"

const zhCNMessages: Record<string, string> = {
  Language: "语言",
  "Browser automation platform": "浏览器自动化平台",
  "Running {count}": "运行中 {count}",
  "Succeeded {count}": "已成功 {count}",
  "Failed {count}": "已失败 {count}",
  passed: "已通过",
  failed: "失败",
  success: "成功",
  running: "运行中",
  queued: "已排队",
  empty: "空",
  available: "可用",
  "Restart onboarding": "重新开始引导",
  Help: "帮助",
  "Quick Launch": "快速启动",
  "Run commands and templates": "运行命令和模板",
  "Task Center": "任务中心",
  "Review run status": "查看运行状态",
  "Operations Deck": "运行面板",
  "Locate the current run first, then narrow the problem through status, details, and terminal output":
    "先定位当前运行，再通过状态、详情和终端输出逐步收窄问题。",
  "Use the left side to filter and switch between run records, the right side to focus the current context, and the bottom terminal to explain what happened. Start with the main run before diving into deeper debugging actions.":
    "左侧用于筛选和切换运行记录，右侧用于聚焦当前上下文，底部终端用于解释发生了什么。在深入排障动作之前，先确认主运行记录。",
  Waiting: "等待中",
  "Failed records": "失败记录",
  "Task Center run record types": "任务中心记录类型",
  "Evidence state: {state}": "证据状态：{state}",
  "Run Records (Command)": "运行记录（命令）",
  "Run Records (Template)": "运行记录（模板）",
  "Run Records": "运行记录",
  "Evidence Runs": "证据运行",
  "Run records list (command)": "运行记录列表（命令）",
  "Run Record Details: Source / Status / Progress / Timeline / Output":
    "运行记录详情：来源 / 状态 / 进度 / 时间线 / 输出",
  Refresh: "刷新",
  "All statuses": "所有状态",
  "Filter tasks by status": "按状态筛选任务",
  "Filter by command ID": "按命令 ID 筛选",
  "Filter run records by command ID": "按命令 ID 筛选运行记录",
  "Run count limit": "运行数量上限",
  "20 records": "20 条记录",
  "50 records": "50 条记录",
  "100 records": "100 条记录",
  "200 records": "200 条记录",
  "No run records yet": "还没有运行记录",
  "Run a command from Quick Launch to see records here.": "先从快速启动运行一条命令，这里才会出现记录。",
  "Template run records appear here after you select a template and start a run from Quick Launch.":
    "在快速启动里选择模板并开始运行后，模板运行记录会出现在这里。",
  "Go to Quick Launch": "前往快速启动",
  "Run records list (template)": "运行记录列表（模板）",
  Cancel: "取消",
  "Run list loading failed": "运行列表加载失败",
  'Click "Refresh" and try again, or start a new run if needed.':
    '点击“刷新”后再试；如果需要，也可以重新发起一次新运行。',
  "Check the details pane and the run log.": "查看详情面板和运行日志。",
  "Evidence run history is unavailable": "当前无法加载证据运行历史",
  "The backend could not load canonical evidence runs.": "后端当前无法加载 canonical evidence runs。",
  "No canonical evidence surface yet": "还没有 canonical evidence surface",
  "No retained evidence runs yet": "还没有保留的 evidence runs",
  "Webaudit cannot find the canonical runs directory in this checkout yet. Start with the canonical run first so the manifest-backed evidence surface can exist.":
    "Webaudit 还没有在当前 checkout 中找到 canonical runs 目录。先跑 canonical run，manifest-backed evidence surface 才会真正存在。",
  "The canonical runs directory exists, but there are no retained evidence runs to inspect yet. Run the canonical path first, then come back here to explain, share, or compare the result.":
    "canonical runs 目录已经存在，但目前还没有可检查的 retained evidence run。先跑 canonical path，再回来解释、分享或比对结果。",
  "This tab becomes useful after the first canonical run creates the manifest, summary, and proof reports.":
    "这个标签页会在第一次 canonical run 产出 manifest、summary 和 proof reports 后真正有用。",
  "A retained run is the point where you can safely explain, share, compare, and think about promotion.":
    "只有 retained run 才是安全做解释、分享、比对和 promotion 判断的起点。",
  "Run the canonical flow": "运行 canonical flow",
  "Canonical evidence runs list": "canonical evidence runs 列表",
  "Current Focus": "当前焦点",
  "Command run context": "命令运行上下文",
  "Template run context": "模板运行上下文",
  "Canonical evidence context": "canonical evidence 上下文",
  "Command mainline": "命令主线",
  "Template mainline": "模板主线",
  "Evidence registry": "证据注册面",
  Source: "来源",
  "Command ID": "命令 ID",
  Attempt: "尝试次数",
  "Created At": "创建时间",
  "Finished At": "完成时间",
  Message: "消息",
  "Exit Code": "退出码",
  "Template ID": "模板 ID",
  "Step Progress": "步骤进度",
  "Last Error": "最近错误",
  "Check the current task status, errors, and output first, then decide whether to cancel or retry.":
    "先检查当前任务状态、错误和输出，再决定是取消还是重试。",
  "Check whether the template run needs input, is waiting to resume, or needs step log review before doing anything else.":
    "在做其他动作前，先看模板运行是否需要输入、是否在等待恢复、以及是否需要看步骤日志。",
  "Inspect retained versus missing evidence first, then follow the linked run and task identifiers before drilling into screenshots, proof, or reports.":
    "先看 evidence 是 retained 还是 missing，再顺着 linked run 和 task identifiers 往下钻，最后才看截图、proof 或 reports。",
  "Correct the current step input and retry.": "修正当前步骤输入后再重试。",
  "Review the run log and the Task Center detail panel on this page.": "查看运行日志和本页的任务中心详情面板。",
  "Select a run record to inspect the details": "选择一条运行记录查看详情",
  "Choose a record from the command run list on the left to inspect its details and output log.":
    "从左侧命令运行列表中选择一条记录，查看它的详情和输出日志。",
  "Choose a record from the template run list on the left to inspect its status, parameters, and logs.":
    "从左侧模板运行列表中选择一条记录，查看它的状态、参数和日志。",
  "Run Log": "运行日志",
  "Baseline candidate": "基线候选",
  "Why this evidence matters": "为什么这条证据重要",
  "This run is retained, so it is the best place to explain what happened, prepare a share pack, compare against another run, and decide whether it is ready to promote.":
    "这条运行已经 retained，所以它是解释发生了什么、准备 share pack、与其他 run 做 compare、并判断是否值得 promote 的最佳起点。",
  "This run is missing required proof paths. Read the explanation first and avoid treating it as an authoritative result.":
    "这条运行缺少必要的 proof paths。先读 explanation，不要把它当成权威结果。",
  "This run is only partially retained. Check the missing paths before you share or promote it.":
    "这条运行只被部分保留。分享或 promote 之前，先检查缺失路径。",
  "This run has no retained evidence yet. Start from the canonical path again before relying on it.":
    "这条运行目前还没有 retained evidence。在依赖它之前，请重新从 canonical path 走一次。",
  "Compare board": "比对面板",
  "You need another retained evidence run before compare becomes a useful judgment surface.":
    "你还需要另一条 retained evidence run，compare 才能成为有判断力的 surface。",
  "Evidence operations": "证据操作",
  "Start by explaining the current run, then package it for sharing, compare it against another retained run, and only then decide whether it deserves promotion.":
    "先解释当前运行，再打包用于分享，再和另一条 retained run 做 compare，最后才决定它是否值得 promote。",
  "Explain this run": "解释这条运行",
  "Share pack": "分享包",
  "Compare runs": "比对运行",
  "Review workspace": "审阅工作区",
  "Promotion guidance": "Promotion 指南",
  "Operator decision ladder": "操作员决策阶梯",
  "Use the recommended move first, then continue in this order so the operator story stays explainable and reviewable.":
    "先执行推荐动作，再按这个顺序继续，这样整个操作员故事才会保持可解释、可审阅。",
  "Review ladder meaning": "审阅阶梯含义",
  "This surface is downstream of explanation, share pack, and compare. Treat it as the maintainer-facing packet before promotion becomes the next move.":
    "这个 surface 位于 explanation、share pack 和 compare 之后。把它当成面向维护者的审阅包，在 promotion 成为下一步之前先经过这里。",
  "The explainer is the first reading step. Use it to stabilize the operator story before you compare, share, or open promotion guidance.":
    "Explainer 是第一步阅读面。先用它把操作员故事讲稳，再进入 compare、share 或 promotion guidance。",
  Profile: "Profile",
  Target: "目标",
  Retention: "保留状态",
  Correlation: "关联",
  "not linked": "未关联",
  "Linked Runs": "关联运行",
  "Linked Tasks": "关联任务",
  none: "无",
  Manifest: "Manifest",
  Summary: "Summary",
  missing: "缺失",
  "Evidence Count": "证据数量",
  "Missing Paths": "缺失路径",
  "Parse Error": "解析错误",
  "Select an evidence run to inspect the bundle": "选择一条证据运行来检查证据包",
  "Choose a canonical evidence run from the left to inspect retention state, linked identifiers, and manifest-backed proof paths.":
    "从左侧选择一条 canonical evidence run，查看保留状态、关联标识，以及 manifest-backed proof paths。",
  "This run already looks promotion-friendly at the product level.":
    "从产品层面看，这条运行已经相对适合进入 promotion。",
  "Treat promotion as a later decision after the evidence is fully reviewable.":
    "请把 promotion 留到 evidence 完全可审阅之后再决定。",
  "Promotion should wait until this run is retained. Treat missing or partial evidence as a review blocker, not as release-ready proof.":
    "在这条运行被 retained 之前，promotion 应该继续等待。请把 missing 或 partial evidence 当成审阅 blocker，而不是 release-ready proof。",
  "Promotion should wait until provenance is attached. A retained bundle without provenance is still missing part of the trust story.":
    "在 provenance 挂上之前，promotion 应该继续等待。没有 provenance 的 retained bundle 仍然缺少信任链的一部分。",
  "This retained run already has provenance and a shareable summary. Review it as a promotion candidate after you explain or share the evidence.":
    "这条 retained run 已经带有 provenance，也有可分享摘要。先解释或分享 evidence，再把它作为 promotion candidate 来审阅。",
  "Promotion becomes useful after you generate and review the evidence share pack.":
    "在生成并审阅 evidence share pack 之后，promotion 才真正有意义。",
  "Promotion is staged for maintainer review before it can be cited by release or showcase surfaces.":
    "Promotion 已进入维护者审阅阶段，在它能被 release 或 showcase surface 引用之前，还需要完成审阅。",
  "Promotion is approved and can be cited by release or showcase surfaces without pointing at raw run artifacts.":
    "Promotion 已获批准，可以被 release 或 showcase surface 引用，而不必再指向原始运行 artifacts。",
  "Promotion remains a candidate until a maintainer advances it to review or approved.":
    "在维护者把它推进到 review 或 approved 之前，Promotion 仍然只是 candidate。",
  "Candidate {id} · {retentionState}": "候选 {id} · {retentionState}",
  "Recommended next operator move": "推荐给操作员的下一步",
  "Review ladder": "审阅阶梯",
  "Explain first, before raw logs or promotion.": "先解释，再看原始日志，也不要先冲向 promotion。",
  "Prepare the share pack before widening handoff.": "在扩大 handoff 之前，先准备 share pack。",
  "Compare against a retained baseline when context still feels thin.": "如果上下文仍然偏薄，就先和 retained baseline 做 compare。",
  "Open the review workspace before treating promotion as the default next move.":
    "在把 promotion 当成默认下一步之前，先打开审阅工作区。",
  "Use promotion guidance only after the packet is reviewable.": "只有在 packet 已可审阅之后，才使用 promotion guidance。",
  "Retain the evidence bundle first": "先补齐证据包",
  "Keep this run out of sharing and promotion decisions until the retained bundle is complete.":
    "在 retained bundle 完整之前，不要把这条运行带进分享或 promotion 决策。",
  "Explain the run first": "先解释这次运行",
  "Use the explainer before compare or promotion so the operator has one grounded reading of what happened.":
    "在做 compare 或 promotion 之前，先使用 explainer，让操作员先拿到一个 grounded 的结果解释。",
  "Prepare the share pack": "准备分享包",
  "Package the current run into a handoff-friendly summary before you widen review or promotion discussion.":
    "在扩大 review 或 promotion 讨论之前，先把当前运行整理成适合 handoff 的摘要。",
  "Resolve compare gaps": "先解决 compare 缺口",
  "The compare still gives context, but it is not strong enough for a confident handoff or promotion judgment.":
    "这次 compare 仍然有参考价值，但还不足以支撑有把握的 handoff 或 promotion 判断。",
  "Open the review workspace": "打开审阅工作区",
  "The packet is ready for maintainer-facing review. Use that surface before you treat promotion as the next default move.":
    "这个 packet 已经可以给维护者审阅了。在把 promotion 当成默认下一步之前，先用这块 surface。",
  "Review promotion guidance": "查看 promotion 指南",
  "The retained run already looks strong enough for promotion review, but promotion should still stay downstream of explanation and review.":
    "这条 retained run 看起来已经足够进入 promotion review，但 promotion 仍然应该放在 explanation 和 review 之后。",
  "Compare before handoff": "交接前先 compare",
  "Use a retained baseline comparison before you widen the handoff, even if the current run already looks healthy.":
    "即使当前运行已经看起来很健康，在扩大 handoff 之前也先做一次 retained baseline compare。",
  "Canonical evidence keeps the run bundle inspectable even when the runtime directory later changes.":
    "即使运行时目录之后发生变化，canonical evidence 仍然让这份运行包保持可检查。",
  "Compare not ready": "Compare 尚未就绪",
  "Partial compare": "部分 Compare",
  "Regression risk higher": "回归风险更高",
  "Looks steadier than baseline": "看起来比 baseline 更稳定",
  "Stable versus baseline": "相对 baseline 稳定",
  "Ready compare": "对比已就绪",
  "This comparison is complete enough to support operator review.":
    "这次对比已经足够完整，可以支撑操作员审阅。",
  "This comparison is only partial, so keep it as context rather than as a release or promotion verdict.":
    "这次对比仍然不完整，所以应把它当作参考上下文，而不是 release 或 promotion verdict。",
  "Flow Workshop": "流程工坊",
  "Edit and debug flows": "编辑并调试流程",
  "Not run yet": "尚未运行",
  "Failed at {stepId}": "失败于 {stepId}",
  Passed: "已通过",
  "Start one recording run from Quick Launch first to generate the initial flow draft.":
    "先从快速启动发起一次录制运行，生成最初的 flow draft。",
  'Save the draft first, then click "Replay Latest Flow" to complete the first run.':
    "先保存 draft，然后点击“重放最新流程”来完成第一次运行。",
  "Resume from {stepId} and correct that step.": "从 {stepId} 恢复并修正该步骤。",
  "Review the key screenshots, then reuse the flow with confidence.":
    "先检查关键截图，再更有把握地复用这条流程。",
  "Flow Control Deck": "流程控制面板",
  "Converge on the outcome first, then move into diagnostics, editing, and evidence review":
    "先收敛结果，再进入诊断、编辑和证据审阅。",
  "This screen keeps the most important outcome and next action at the top. Advanced diagnostics and evidence drill-down stay available below without fragmenting attention too early.":
    "这个界面把最重要的结果和下一步动作放在最上面。更高级的诊断和证据下钻仍然保留在下方，避免过早分散注意力。",
  "Draft ready": "草稿已就绪",
  "Waiting for the first draft recording": "等待第一次草稿录制",
  "{count} evidence nodes": "{count} 个证据节点",
  "No evidence nodes yet": "还没有证据节点",
  "Fix pending at {stepId}": "{stepId} 仍待修复",
  "No failures in the current replay": "当前重放没有失败",
  "Key outcome and next action": "关键结果与下一步动作",
  'Flow Workshop is the advanced zone. For a first run, you only need "Save Draft → Replay Latest Flow".':
    "流程工坊是高级区域。第一次运行时，你只需要“保存草稿 -> 重放最新流程”。",
  Draft: "草稿",
  Ready: "已就绪",
  Missing: "缺失",
  "Latest replay": "最近一次重放",
  "Save Draft": "保存草稿",
  "Replay Latest Flow": "重放最新流程",
  "Template reuse lane": "模板复用区",
  "This lane answers one operator question first: is the current template stable enough to reuse, or should it stay in workshop mode?":
    "这个区域先回答一个操作员问题：当前模板是否已经稳定到可以复用，还是应该继续留在工坊模式？",
  "No templates available yet": "还没有可用模板",
  "Import or save a flow first, then come back here to review whether it is safe to reuse.":
    "先导入或保存一条流程，再回来判断它是否已经安全到可以复用。",
  "Selected template": "已选模板",
  "Why this lane exists": "为什么需要这个区域",
  "Use template reuse only after the canonical and workshop path already feels trustworthy. A template is an operator shortcut, not the first proof step.":
    "只有当 canonical path 和 workshop path 已经可信时，才进入模板复用。模板是操作员捷径，不是第一步 proof。",
  "Template signals": "模板信号",
  "Advanced workshop (optional): system diagnostics, flow editing, and debugging evidence":
    "高级工坊（可选）：系统诊断、流程编辑与调试证据",
  "System status": "系统状态",
  Uptime: "运行时长",
  "Total tasks": "任务总数",
  Health: "健康状态",
  Healthy: "健康",
  Degraded: "降级",
  "Optional AI assistant": "可选 AI 助手",
  "Use reconstruction only when artifacts already exist and a human still plans to review the generated flow. This is an advanced assistant, not the deterministic mainline.":
    "只有在 artifacts 已经存在且人类仍打算审阅生成流程时，才使用 reconstruction。它是高级助手，不是 deterministic mainline。",
  "For AI-agent builders, this is the strongest current AI surface because it stays downstream of proof and inside a reviewable workshop lane.":
    "对于 AI-agent builders 来说，这是当前最强的 AI surface，因为它始终位于 proof 之后，并且留在可审阅的 workshop lane 之内。",
  "Latest flow": "最新流程",
  Replay: "重放",
  "Session #{id} · {stepCount} steps · {eventCount} events": "会话 #{id} · {stepCount} 步 · {eventCount} 个事件",
  "Latest flow steps": "最新流程步骤",
  "No additional detail": "没有额外详情",
  "No flow data yet": "还没有流程数据",
  "Run one recording command and the generated flow data will appear here automatically.":
    "先运行一次录制命令，生成的流程数据就会自动出现在这里。",
  "Flow editor": "流程编辑器",
  "Replay prerequisite waiting conditions during breakpoint resume": "在断点恢复时重放前置等待条件",
  "Autonomy Lab Phase 1": "自治实验室第 1 阶段",
  Experimental: "实验性",
  "{count} artifact anchors": "{count} 个 artifact 锚点",
  "Manual-only gates stay manual": "手动门继续保持手动",
  "Autonomy Lab is the bounded experiment lane for artifact-driven reconstruction after proof already exists. It exposes real reviewable actions without reopening autonomous self-heal or hidden write paths.":
    "自治实验室是在 proof 已经存在之后，用于 artifact-driven reconstruction 的受限实验通道。它会暴露真实且可审阅的动作，但不会重开 autonomous self-heal 或隐藏写入路径。",
  "Phase 1 stays anchored to reconstruction and orchestration. OTP, provider challenges, and other manual gates remain human-confirmed outside this lab.":
    "第 1 阶段仍然锚定在 reconstruction 与 orchestration。OTP、provider challenge 以及其他手动门都继续留在实验室之外，由人类确认。",
  "Current lab status": "当前实验室状态",
  "Blocked until you attach artifacts or keep one recorded session available.": "在你挂上 artifacts 或保留一个已录制会话之前，这个实验层会保持阻塞。",
  "Artifact anchors are ready. Resolve the profile or preview a draft before generation.": "artifact 锚点已经就绪。请先解析 profile 或预览 draft，然后再进入生成。",
  "A preview exists. Generate a reviewable draft before you promote this into a reusable template.": "现在已经有 preview。请先生成一个可审阅的 draft，再考虑把它推进成可复用模板。",
  "A generated draft exists. You can now turn it into a template while keeping human review in the loop.": "现在已经有生成好的 draft。你可以在保持人工审阅的前提下，把它推进成模板。",
  "Why this is safe": "为什么这仍然安全",
  "The lab is downstream of evidence, uses reviewable reconstruction outputs, and keeps all external-state changes behind explicit human confirmation.": "这个实验层始终位于 evidence 之后，使用可审阅的 reconstruction 输出，并把所有会改变外部状态的动作都放在显式人工确认之后。",
  "Resolve profile from artifacts": "从 artifacts 解析 profile",
  "Preview reviewable draft": "预览可审阅 draft",
  "Generate lab draft": "生成实验草稿",
  "Create template from artifacts": "从 artifacts 创建模板",
  "Evidence Rail": "证据栏",
  "Evidence and status converge here": "证据和状态会在这里汇合",
  "Use this side to answer two questions first: which step failed, and what did the page look like before and after that step? Read the timeline before jumping back to the editor.":
    "先用这里回答两个问题：哪一步失败了？该步骤前后页面分别长什么样？在跳回编辑器之前，先看时间线。",
  "Advanced debugging evidence (optional)": "高级调试证据（可选）",
  "Evidence timeline": "证据时间线",
  "No evidence screenshots yet": "还没有证据截图",
  "After a replay finishes, before/after screenshots for each step appear here.":
    "一次重放结束后，每个步骤的前后截图会出现在这里。",
  "Open step evidence details": "打开步骤证据详情",
  Unknown: "未知",
  "Before execution - {stepId}": "执行前 - {stepId}",
  "After execution - {stepId}": "执行后 - {stepId}",
  "Evidence before execution - {stepId}": "执行前证据 - {stepId}",
  "Evidence after execution - {stepId}": "执行后证据 - {stepId}",
  "Step evidence details": "步骤证据详情",
  "Select a step to inspect the evidence": "选择一个步骤查看证据",
  "Choose a step from the timeline or the editor to inspect its detailed evidence.":
    "从时间线或编辑器里选择一个步骤，以查看它的详细证据。",
  "Step {stepId} has no evidence yet. Replay or rerun it first.": "步骤 {stepId} 目前还没有证据。请先重放或重新运行它。",
  Step: "步骤",
  Status: "状态",
  Duration: "耗时",
  "Matched selector": "匹配到的 selector",
  None: "无",
  Detail: "详情",
  "No screenshot evidence exists for this step": "这个步骤还没有截图证据",
  "Advanced debugging: selector fallback trail": "高级调试：selector fallback 轨迹",
  "No fallback was triggered for this step.": "这个步骤没有触发 fallback。",
  "Selector fallback trail": "Selector fallback 轨迹",
  "Matched successfully": "匹配成功",
  "Failed: {error}": "失败：{error}",
  "Unknown error": "未知错误",
  "Command Run": "命令运行",
  "Template Run": "模板运行",
  Queued: "已排队",
  Running: "运行中",
  Succeeded: "已成功",
  Failed: "已失败",
  Cancelled: "已取消",
  "Waiting for User Input": "等待用户输入",
  "Waiting for OTP": "等待 OTP",
  retained: "已保留",
  partial: "部分保留",
  ready: "就绪",
  partial_compare: "部分对比",
  not_requested: "未请求",
  candidate: "候选",
  review: "审阅中",
  approved: "已批准",
  review_ready: "可审阅",
  review_partial: "需谨慎审阅",
  low: "低",
  medium: "中",
  high: "高",
  unknown: "未知",
  "Run Record #{id}": "运行记录 #{id}",
  "Evidence Run #{id}": "证据运行 #{id}",
  "Record #{id}": "记录 #{id}",
  "Step {count}": "第 {count} 步",
  "Compare data is unavailable right now.": "当前无法获取 compare 数据。",
  "Loading compare view...": "正在加载 compare 视图...",
  "Run Compare": "运行对比",
  "Compare state": "对比状态",
  "State meaning": "状态含义",
  "Gate status delta": "门禁状态变化",
  "Duration delta": "耗时变化",
  "Failed checks delta": "失败检查变化",
  "Missing artifacts delta": "缺失 artifacts 变化",
  "Artifact path changes": "Artifact 路径变化",
  "not available": "不可用",
  "Evidence share pack is unavailable right now.": "当前无法获取 evidence share pack。",
  "Loading evidence share pack...": "正在加载 evidence share pack...",
  "Evidence Share Pack": "证据分享包",
  "Markdown summary": "Markdown 摘要",
  "Issue-ready snippet": "Issue 可用片段",
  "Release appendix": "发布附录",
  "Failure explanation is unavailable right now.": "当前无法获取 failure explanation。",
  "Loading failure explanation...": "正在加载 failure explanation...",
  "Start here before raw logs": "在看原始日志前先从这里开始",
  "Recommended next step": "推荐下一步",
  "Evidence anchors": "证据锚点",
  "Other options": "其他选项",
  "Template readiness is unavailable right now.": "当前无法获取模板就绪度。",
  "Loading template readiness...": "正在加载模板就绪度...",
  "Weak selector coverage": "Selector 覆盖较弱",
  "Missing selector coverage": "缺少 selector 覆盖",
  "Manual gate still required": "仍需要手动 gate",
  "Low-confidence step": "低置信步骤",
  "Ready to reuse": "可以复用",
  "This template is stable enough to reuse after one clean replay. Treat it like an operator-ready shortcut, not a draft.":
    "这份模板在一次干净重放之后已经足够稳定，可以开始复用。请把它当成操作员可用捷径，而不是草稿。",
  "Reuse it with confidence, then compare the next retained run before promoting it wider.":
    "可以放心复用，但在更广泛推广之前，先对下一条 retained run 做 compare。",
  "Review before reuse": "复用前先审阅",
  "This template is reusable, but it still needs a human review before it becomes the default shortcut for operators.":
    "这份模板已经可以复用，但在成为操作员默认捷径之前，仍需要人工审阅。",
  "Inspect the risky steps first, then run one retained comparison before wider reuse.":
    "先检查高风险步骤，再做一次 retained comparison，然后再扩大复用。",
  "Keep in workshop": "继续留在工坊",
  "This template is still draft-quality. Keep it in Flow Workshop until the risky steps and manual gates are reduced.":
    "这份模板仍然是草稿质量。在高风险步骤和 manual gates 降下来之前，请继续留在 Flow Workshop。",
  "Fix the highest-risk steps before handing this flow to someone else.": "在把这条流程交给别人之前，先修正最高风险步骤。",
  "Selector coverage needs review": "Selector 覆盖需要审阅",
  "Manual handoff still exists": "仍然存在手动交接",
  "Template Readiness": "模板就绪度",
  "Reuse verdict": "复用结论",
  "Readiness score": "就绪分数",
  "Risk level": "风险等级",
  "Average confidence": "平均置信度",
  "Selector risk count": "Selector 风险数量",
  "Manual gate density": "手动 gate 密度",
  "Why this is the verdict": "为什么得出这个结论",
  "Inspect first": "优先检查",
  "Suggested next step": "建议下一步",
  "No recovery action is needed right now.": "当前不需要恢复动作。",
  "This run is not currently blocked on user input or recovery.": "当前这次运行并没有被用户输入或恢复动作阻塞。",
  "Submit OTP": "提交 OTP",
  "Provide the OTP code and resume the current run from the same recovery path.":
    "提供 OTP 代码，并沿同一恢复路径继续当前运行。",
  "OTP is a sensitive user-provided credential and must stay manually confirmed.":
    "OTP 属于敏感的用户凭证，必须保持人工确认。",
  "Inspect linked task": "查看关联任务",
  "Open the linked task context before resuming if you need more detail.":
    "如果需要更多细节，请在恢复前先打开关联任务上下文。",
  "Inspection is read-only and does not trigger external side effects.":
    "查看是只读动作，不会触发外部副作用。",
  "This run is waiting for an OTP. Enter it and submit to continue:":
    "这次运行正在等待 OTP。输入后提交即可继续：",
  "Submit the required OTP first, then the run can resume without switching to legacy helper paths.":
    "先提交所需 OTP，然后运行就可以继续，而不需要切回 legacy helper paths。",
  "Continue after provider step": "在 provider 步骤后继续",
  "Complete the provider-hosted challenge or payment step, then continue the current run.":
    "先完成 provider 托管的 challenge 或 payment 步骤，然后继续当前运行。",
  "Provider-hosted challenges or payment steps can carry external side effects and must stay manual.":
    "Provider 托管的 challenge 或 payment 步骤可能带来外部副作用，必须保持手动。",
  "Submit additional input": "提交补充输入",
  "Provide the missing manual input and resume the current run.":
    "补齐缺失的手动输入后，继续当前运行。",
  "Additional input can change external workflow state and should remain operator-confirmed.":
    "补充输入可能改变外部工作流状态，因此应保持操作员确认。",
  "Replay from the suggested recovery step if you need to re-establish the flow before resuming.":
    "如果你需要在恢复前重新建立流程，请从建议的恢复步骤开始重放。",
  "Replay can change runtime state, so review the step first and trigger it intentionally.":
    "重放会改变 runtime state，所以请先检查步骤，再有意识地触发。",
  "Review the linked task output before continuing if the wait reason is unclear.":
    "如果等待原因不清楚，继续前先检查关联任务输出。",
  "Inspection is safe because it only surfaces existing task context.":
    "查看是安全的，因为它只会展示已有任务上下文。",
  "The payment page is already open. Complete the provider step manually, then continue here.":
    "支付页面已经打开。先手动完成 provider 步骤，再回到这里继续。",
  "Continue the same run after the provider-hosted step is complete, then use replay only if the flow still needs a guided retry.":
    "provider 托管步骤完成后，继续同一次运行；只有当流程仍然需要引导式重试时，才使用重放。",
  "This run is waiting for additional input. Provide it and submit to continue:":
    "这次运行正在等待补充输入。输入后提交即可继续：",
  "Use the guided resume action first. If that is not enough, replay from the suggested step instead of guessing the right endpoint.":
    "先使用引导式恢复动作。如果这还不够，再从建议步骤开始重放，而不是猜正确入口。",
  "Replay from the nearest recovery step and correct the failure before retrying the full path.":
    "从最近的恢复步骤开始重放，先修正失败，再重试完整路径。",
  "Replay is useful for guided recovery, but it still changes runtime state and should stay human-confirmed.":
    "重放对引导式恢复很有帮助，但它仍然会改变 runtime state，所以应保持人工确认。",
  "Replay latest flow": "重放最新流程",
  "Replay from {stepId}": "从 {stepId} 开始重放",
  "Replay step {stepId}": "重放步骤 {stepId}",
  "Rerun the latest flow draft to reproduce the failure under the current workspace state.":
    "在当前 workspace 状态下重新运行最新的 flow draft，以复现故障。",
  "A full replay is valuable for reproduction, but it should remain an operator-triggered choice.":
    "完整重放对复现故障很有价值，但它应当继续保持为操作员触发的选择。",
  "Replay only the failing step when you want a tighter debugging loop.":
    "当你想要更紧的调试回路时，只重放失败的那一步。",
  "Step replay stays human-confirmed because it can still change runtime state.":
    "步骤重放仍需人工确认，因为它同样会改变 runtime state。",
  "Review the task output and run log before retrying.": "重试之前先查看任务输出和运行日志。",
  "Inspection is read-only and safe to recommend immediately.": "查看是只读的，所以可以立即安全地推荐。",
  "This run failed and needs a guided retry.": "这次运行失败了，需要一次引导式重试。",
  "Start from the suggested replay action instead of jumping straight to raw logs or manual shell commands.":
    "先从建议的重放动作开始，不要直接跳进原始日志或手动 shell 命令。",
  "This run is still active.": "这次运行仍然处于活跃状态。",
  "Recovery is not needed yet. Inspect the linked task first if you need more context.":
    "现在还不需要恢复动作。如果你需要更多上下文，请先查看关联任务。",
  "Review the linked task output while this run is still active.":
    "趁这次运行仍然活跃，先查看关联任务输出。",
  "Inspection is safe because it does not modify the active run.":
    "查看是安全的，因为它不会修改当前活跃运行。",
  "This run does not currently require guided recovery.": "这次运行当前不需要引导式恢复。",
  "Use the evidence and linked task details if you need to inspect what happened.":
    "如果你需要检查发生了什么，请查看证据和关联任务详情。",
  manifest: "manifest",
  summary: "summary",
  "Recreate or retain the missing evidence artifacts before treating this run as authoritative.":
    "在把这次运行当成权威结果之前，先重新生成或保留缺失的 evidence artifacts。",
  "Review the new failed checks introduced in the compare result before retrying.":
    "重试之前，先查看 compare 结果里新增的失败检查项。",
  "Use Recovery Center actions before falling back to raw logs or manual shell commands.":
    "在退回原始日志或手动 shell 命令之前，先使用 Recovery Center 里的动作。",
  "Advisory-only explanation. This summary stays grounded in retained paths and compare output, but it does not replace direct inspection of the linked evidence or justify automatic recovery execution.":
    "这是 advisory-only explanation。它仍然基于 retained paths 和 compare 输出，但不能替代对关联 evidence 的直接检查，也不能为自动恢复执行背书。",
  "Review run {runId} from the retained evidence surface before you promote or share it more widely.":
    "在更广泛地 promote 或 share 之前，先从 retained evidence surface 审阅运行 {runId}。",
  "Run {runId} is in {retentionState} state with gate status {gateStatus}.":
    "运行 {runId} 当前处于 {retentionState} 状态，gate status 为 {gateStatus}。",
  "Compared with {candidateRunId}, the failed check delta is {failedCheckDelta}.":
    "与 {candidateRunId} 相比，failed check 的变化量是 {failedCheckDelta}。",
  "This review workspace is local-first and artifact-backed. It prepares a review packet, but it is not a hosted collaboration platform.":
    "这个审阅工作区是 local-first 且 artifact-backed。它会准备审阅包，但它不是 hosted 协作平台。",
  "Explain the run first.": "先解释这次运行。",
  "Review the share pack and compare state.": "检查 share pack 和 compare 状态。",
  "Use promotion only after the evidence packet is reviewable.": "只有在 evidence packet 可审阅之后，才使用 promotion。",
  "This packet is ready for human review.": "这个审阅包已经可以给人类审阅。",
  "This packet is reviewable, but some evidence or compare context still needs caution.":
    "这个审阅包已经可以看，但某些 evidence 或 compare 上下文仍需谨慎。",
  "Share this review packet with the maintainer who needs the evidence-first summary.":
    "把这个审阅包分享给需要 evidence-first summary 的维护者。",
  "Resolve the missing evidence or partial compare signals before you treat this packet as promotion-ready.":
    "在把这个审阅包视为 promotion-ready 之前，先解决缺失 evidence 或 partial compare signals。",
  "Review workspace is unavailable right now.": "当前无法提供审阅工作区。",
  "Loading review workspace...": "正在加载审阅工作区...",
  "Review Workspace": "审阅工作区",
  "Review-ready": "可审阅",
  "Review with caution": "需谨慎审阅",
  "Local-first review packet. It packages evidence, explanation, compare context, and promotion guidance without pretending to be a hosted collaboration plane.":
    "这是一个 local-first 审阅包，会把证据、解释、compare 上下文和 promotion guidance 放在一起，但不会假装成 hosted 协作平面。",
  "Next review step": "下一步审阅动作",
  "Packet health": "审阅包健康度",
  "Recommended order": "推荐顺序",
  "Explain the run": "解释这次运行",
  "Read the share pack": "阅读分享包",
  "Review compare context": "审查 compare 上下文",
  "Decide promotion status": "决定 promotion 状态",
  retention: "保留",
  compare: "对比",
  "promotion state": "promotion 状态",
  "Webaudit Command Center": "Webaudit 控制台",
  "Evidence-first browser automation with recovery and MCP": "以证据为先的浏览器自动化，内置恢复与 MCP",
  "Start from one canonical run, confirm the result in Task Center, and only then open template reuse, AI reconstruction, or MCP side roads. This is for AI agents, Codex, Claude Code, OpenHands, OpenCode, OpenClaw, and human operators who need inspectable runs instead of guesswork.":
    "先完成一次 canonical run，再到任务中心确认结果，之后才打开模板复用、AI 重建或 MCP 侧路。这套产品面向 AI agents、Codex、Claude Code、OpenHands、OpenCode、OpenClaw，以及需要可检查运行证据的人工操作员。",
  "Primary Actions": "主操作",
  "Advanced Side Roads": "高级侧路",
  "AI Reconstruction Assistant": "AI 重建助手",
  "MCP Integration Side Road": "MCP 集成侧路",
  Integration: "集成",
  "Open Flow Workshop": "打开流程工坊",
  "Open MCP guide": "打开 MCP 指南",
  "They also form the strongest bridge for AI-agent builders using Codex, Claude Code, OpenHands, OpenCode, OpenClaw, or other tool-using shells who need browser evidence, governed MCP access, and artifact-first reconstruction without turning the product into a generic bot platform.":
    "它们同样构成了面向使用 Codex、Claude Code、OpenHands、OpenCode、OpenClaw 或其他可调用工具外壳的 AI-agent builders 的最强桥梁：既提供 browser evidence、governed MCP access 与 artifact-first reconstruction，又不会把产品讲成 generic bot platform。",
  "Named ecosystem fit": "命名生态适配",
  "MCP-first today: Claude Code / OpenCode": "当前更偏 MCP-first：Claude Code / OpenCode",
  "API-first or hybrid today: Codex, OpenHands, and OpenClaw. Use this as a discovery rule, not as an official-integration claim.":
    "当前更偏 API-first 或 hybrid：Codex、OpenHands 和 OpenClaw。把它当成 discovery 规则，不要把它理解成官方集成声明。",
  "Named ecosystem fit matrix": "命名生态适配矩阵",
  "MCP-first": "MCP-first",
  "API-first or hybrid": "API-first 或 hybrid",
  "Codex / OpenHands / OpenClaw": "Codex / OpenHands / OpenClaw",
  "Step 3: switch to Task Center, confirm the result, and use Recovery Center there before raw logs or workshop replay.":
    "第 3 步：切到任务中心确认结果，并在退回原始日志或工坊重放前先使用其中的 Recovery Center。",
  "Use Recovery Center before raw logs or workshop replay": "在原始日志或工坊重放之前先使用 Recovery Center",
  "Treat Recovery Center as the official recovery layer inside Task Center. Only move to raw logs or Flow Workshop after the suggested recovery path still leaves you blocked.":
    "把 Recovery Center 视为任务中心里的官方恢复层。只有在建议的恢复路径仍然不能解阻时，才继续进入原始日志或 Flow Workshop。",
  "Recovery Center is the official recovery layer inside Task Center and Flow Workshop. Use it before raw logs or shell fallbacks.":
    "Recovery Center 是 Task Center 和 Flow Workshop 里的官方恢复层。在退回原始日志或 shell fallback 之前先使用它。",
}

function formatMessage(template: string, values?: TranslationValues) {
  if (!values) return template
  return template.replace(/\{(\w+)\}/g, (_, key: string) => {
    const value = values[key]
    return value === undefined ? `{${key}}` : String(value)
  })
}

export function translate(locale: AppLocale, message: string, values?: TranslationValues) {
  if (locale === "en") return formatMessage(message, values)
  return formatMessage(zhCNMessages[message] ?? message, values)
}
