/**
 * DSH Fly engagement 抽屉面板（浏览器半边）。
 *
 * 数据来自**本包自己的宿主行**（`GET /fly/engagement/state|report`，见根 `index.js`）——
 * 面板自己不持有任何能力。样式**就是**目标效果图那一份（`.fly-eg-*` + `var(--dsw-alias-*, 兜底)`），
 * 因此"照图实现"与真面板是同一套规则，不会漂移成第二套。
 *
 * 形状照 `dsh-plugin-fly-smart`：`slots.inject('sidebar.right.pane.tab')` + `sidebarRightTabs.register`
 * （面板那一行必须是**裸包名**，带 `/` 的行名客户端半边登记不上 —— 见 cordis.patch.yml 的注释）。
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'

export const name = 'fly-engagement-panel'
export const inject = ['slots', 'sidebarRightTabs']

const PACKAGE = '@dsh-fly/dsh-plugin-fly-engagement'
const KIND = 'fly.engagement'
const TAB_TITLE = 'Engagement'
const TAB_DESCRIPTION = '目标 / 资产 / 漏洞 / 证据图'
const GUIDE_ORDER = 12
const BASE = '/fly/engagement'
const STORE_KEY = 'fly.engagement.workspace'

/** 目标效果图那一份样式（压缩成一行注释头的原样拷贝）。 */
const PANEL_CSS = `/*
 * fly-engagement 抽屉面板 —— **目标效果图的样式表**（2026-10-18，等用户判方向）
 *
 * 这张表就是实现时的对照物：类名 / token / 尺寸都按真面板的约定写（'.fly-eg-*' 前缀，
 * 与 shell 的 '.fly-*' 一族同形），所以"照图实现"不会漂移成另一套。
 *
 * token 纪律：这里因为要**独立渲染**（没有宿主 skin），把深色底值写进 ':root' 兜底；
 * 实现时一律 'var(--dsw-alias-*, 兜底)' —— 真宿主会给出 token，兜底只在 mock/降级时生效。
 * 面板框（rail 8px / desk 12px / 3px 亮缘）照 '.fly-panel' 的结构，不再发明第二套。
 */
/* 2026-10-19：这三条**只属于独立效果图页**（body padding / 全页重置 / token 兜底），
   不能注入宿主 —— 它们把宿主页面挤了 12px 并刷成不透明底，症状是"侧栏卡片与 App 边缘
   之间多出一条黑边、发光顶不到边"（用户判词）。宿主里每一条声明都自带 var() 兜底，
   不需要这里的 :root。留注释备查，mock 页仍按原样式表渲染。 */
/* ── 面板框：照 .fly-panel 的结构（rail 8px / 3px 亮缘 / 底部关系型亮缘） ── */
/* 滚动可达性：宿主页签容器（P3OORG_tabBody）是 flex column + height:100% +
   overflow:hidden，而本面板只声明了宽度与内边距 —— 高度由内容撑开、溢出被父层裁掉，
   整条祖先链上没有滚动容器，所以是"根本不能滚"。
   修法：让面板自己成为滚动容器（可收缩的 flex 子项 + min-height:0；不 grow，短内容不拉伸），
   与 fly-smart 的 .fly-panel 同一处方。max-width 兜住窄抽屉下的横向溢出。 */
.fly-eg-panel {
  --fly-rail: 8px;
  box-sizing: border-box;
  flex: 0 1 auto;
  min-height: 0;
  width: 760px;
  max-width: 100%;
  overflow-y: auto;
  overscroll-behavior: contain;
  border-radius: 12px;
  border: 1px solid var(--dsw-alias-border-l1);
  background:
    radial-gradient(900px 320px at 12% -12%, rgba(240, 165, 90, 0.10), transparent 70%),
    linear-gradient(180deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0) 42%),
    var(--dsw-alias-bg-base);
  padding: var(--fly-rail) calc(var(--fly-rail) + 6px) calc(var(--fly-rail) + 8px);
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

/* ── 头部：工作区 + goal + authorization ── */
.fly-eg-head { display: flex; flex-direction: column; gap: 6px; padding-bottom: 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.fly-eg-title { display: flex; align-items: baseline; gap: 8px; }
.fly-eg-title h1 { margin: 0; font-size: 15px; font-weight: 600; letter-spacing: 0.2px; }
.fly-eg-badge { font-size: 11px; padding: 1px 7px; border-radius: 999px; background: var(--fly-accent-dim); color: var(--fly-accent); border: 1px solid rgba(240, 165, 90, 0.35); }
.fly-eg-meta { font-size: 11.5px; color: var(--dsw-alias-fg-secondary); display: flex; flex-wrap: wrap; gap: 10px; }
.fly-eg-mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 11.5px; color: var(--dsw-alias-fg-primary); }
.fly-eg-auth { font-size: 11.5px; color: var(--dsw-alias-fg-muted); }
.fly-eg-auth b { color: var(--fly-accent); font-weight: 600; }

/* ── 计数读数：counts + dropped/refused/truncated（截断显眼） ── */
.fly-eg-counters { display: flex; gap: 4px; margin: 8px 0; flex-wrap: wrap; align-items: center; }
.fly-eg-counter { border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); border-radius: 6px; padding: 2px 6px; font-size: 10.5px; line-height: 1.5; color: var(--dsw-alias-fg-muted); }
.fly-eg-counter b { margin-left: 3px; font-size: 11px; }
.fly-eg-counter b { color: var(--dsw-alias-fg-primary); font-weight: 600; margin-left: 5px; }
.fly-eg-counter.is-warn { border-color: rgba(255, 95, 109, 0.45); background: rgba(255, 95, 109, 0.10); color: #ffb8be; }
.fly-eg-counter.is-warn b { color: #ffd7da; }

/* ── 表/图 切换（借 dsh-pentest AssetsView 的两模式） ── */
.fly-eg-tabs { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); margin-bottom: 10px; }
.fly-eg-tab { font-size: 11.5px; padding: 3px 10px; border-radius: 6px; color: var(--dsw-alias-fg-secondary); }
.fly-eg-tab.is-active { background: rgba(240, 165, 90, 0.18); color: var(--fly-accent); }

/* ── 分区标题 ── */
.fly-eg-section { margin-top: 12px; }
.fly-eg-section > h2 { margin: 0 0 6px; font-size: 12px; font-weight: 600; color: var(--dsw-alias-fg-secondary); letter-spacing: 0.4px; text-transform: uppercase; }

/* ── 表 ── */
.fly-eg-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.fly-eg-table th { text-align: left; font-weight: 500; color: var(--dsw-alias-fg-muted); font-size: 11px; padding: 4px 6px; border-bottom: 1px solid var(--dsw-alias-border-l1); }
/* overflow-wrap:anywhere 让单元格的**最小内容宽**变小 —— sha256、长路径这类
   不可断长串不再把表格撑出卡片（word-break 只在排版时折行，不影响最小宽）。 */
.fly-eg-table td { padding: 5px 6px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); vertical-align: top; overflow-wrap: anywhere; word-break: break-word; }
/* id 列整行不折（fact-1 不该断成 fact-\n1），宽让给正文列。 */
.fly-eg-id { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: var(--dsw-alias-fg-muted); white-space: nowrap; }
.fly-eg-src { font-size: 11px; color: var(--dsw-alias-fg-muted); }
.fly-eg-src b { color: var(--dsw-alias-fg-secondary); font-weight: 500; }
.fly-eg-sev { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 999px; display: inline-block; }
.fly-eg-sev.critical { color: #fff; background: var(--fly-critical); }
.fly-eg-sev.high { color: #1a0f06; background: var(--fly-high); }
.fly-eg-sev.medium { color: #1a1506; background: var(--fly-medium); }
.fly-eg-sev.low { color: #061019; background: var(--fly-low); }
.fly-eg-sev.info { color: #0b1017; background: var(--fly-info); }
/* 复现步骤 = 编号清单 + 行尾 ⧉ 单条复制（勾选功能已撤：li 保持 list-item，编号才有）。 */
.fly-eg-steps { margin: 4px 0 0 0; padding-left: 20px; color: var(--dsw-alias-fg-secondary); font-size: 11.5px; }
.fly-eg-step { position: relative; margin: 2px 0; padding-right: 20px; }
.fly-eg-step-text { font-family: ui-monospace, Menlo, monospace; font-size: 11px; background: rgba(255, 255, 255, 0.06); padding: 0 4px; border-radius: 4px; overflow-wrap: anywhere; }
.fly-eg-step-copy { position: absolute; right: 0; top: 0; border: none; background: none; padding: 0; cursor: pointer; color: var(--dsw-alias-fg-muted); font-size: 11.5px; line-height: 1.5; opacity: 0.55; }
.fly-eg-step-copy:hover { opacity: 1; color: var(--fly-accent); }
/* Report 标题行：标题左、动作右。 */
.fly-eg-section-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.fly-eg-copy { font-size: 11px; padding: 2px 9px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-fg-secondary); cursor: default; }
.fly-eg-copy:hover { color: var(--dsw-alias-fg-primary); border-color: rgba(240, 165, 90, 0.45); }
.fly-eg-copy.is-done { color: var(--fly-accent); border-color: rgba(240, 165, 90, 0.55); }
.fly-eg-steps code, .fly-eg-cmd { font-family: ui-monospace, Menlo, monospace; font-size: 11px; background: rgba(255, 255, 255, 0.06); padding: 0 4px; border-radius: 4px; overflow-wrap: anywhere; white-space: pre-wrap; }

/* ── 图区：静态分层 + 边胶囊 + 只读（借 xyflow 的形状，不引入拖拽） ── */
/* 图框：内层 .fly-eg-canvas 是按布局算出来的固定宽度，放不下时横向滚动（不裁剪）。 */
.fly-eg-graph { position: relative; height: 300px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: radial-gradient(600px 240px at 50% 0%, rgba(255,255,255,0.035), transparent 70%), var(--dsw-alias-bg-layer-1); overflow-x: auto; overflow-y: hidden; }
.fly-eg-canvas { position: relative; }
.fly-eg-graph-hint { position: absolute; left: 8px; bottom: 6px; font-size: 10.5px; color: var(--dsw-alias-fg-muted); }
.fly-eg-graph-badge { position: absolute; right: 8px; top: 8px; font-size: 10.5px; padding: 2px 7px; border-radius: 999px; border: 1px solid rgba(255, 95, 109, 0.45); background: rgba(255, 95, 109, 0.12); color: #ffb8be; }
/* 节点宽 = 内容宽（max-content）：短文本的框刚好包住文字；超过 240px 才省略号。
   真宽由 Graph 用 useLayoutEffect 量 offsetWidth 回填给布局（列宽、线头都用它）。 */
.fly-eg-node { position: absolute; transform: translate(-50%, -50%); box-sizing: border-box; width: max-content; max-width: 240px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); padding: 5px 9px; font-size: 11.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 色调规则在 hover 块**之前**：hover 靠同等特异性 + 源顺序压过它们，色调 hover 又以更高特异性收尾。 */
.fly-eg-node.is-finding { border-color: rgba(255, 155, 82, 0.55); background: rgba(255, 155, 82, 0.14); color: #ffd7b0; }
.fly-eg-node.is-asset { border-color: rgba(111, 194, 255, 0.45); background: rgba(111, 194, 255, 0.12); color: #cbe8ff; }
/* hover 展开全文：宽回到内容宽（封顶 420px 仍换行），抬高 z-index 压住邻居；
   被截断的内容从此 hover 就能读全 —— 不依赖原生 title（迟 1 秒、样式也不可控）。
   底色在 hover 时转**不透明**：半透明底一旦压到连线或邻近节点上，下层文字会透上来
   与展开的全文混在一起看不清（用户判词）。三档不透明底与各自的色调边框/字色配套。 */
.fly-eg-node:hover { width: max-content; max-width: 420px; white-space: normal; overflow-wrap: anywhere; overflow: visible; text-overflow: clip; z-index: 5; background: #20272f; border-color: rgba(240, 165, 90, 0.55); box-shadow: 0 10px 28px rgba(0, 0, 0, 0.5); cursor: default; }
.fly-eg-node.is-finding:hover { background: #3a2810; }
.fly-eg-node.is-asset:hover { background: #11293e; }
.fly-eg-edge { position: absolute; height: 1.5px; background: rgba(240, 165, 90, 0.55); transform-origin: 0 50%; }
.fly-eg-edge-cap { position: absolute; font-size: 10px; color: var(--fly-accent); background: rgba(7, 11, 18, 0.85); padding: 0 4px; border-radius: 4px; border: 1px solid rgba(240, 165, 90, 0.3); }

/* ── 报告区 ── */
.fly-eg-report { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 8px 10px; font-size: 11.5px; color: var(--dsw-alias-fg-secondary); overflow-wrap: anywhere; }
/* 报告 Markdown 的排版（受控子集）：三级标题 + 段落 + 列表 + 行内 code/bold。 */
.fly-eg-md-h1 { margin: 2px 0 6px; font-size: 13.5px; font-weight: 650; color: var(--dsw-alias-fg-primary); }
.fly-eg-md-h2 { margin: 10px 0 4px; font-size: 12.5px; font-weight: 650; color: var(--dsw-alias-fg-primary); }
.fly-eg-md-h3 { margin: 8px 0 3px; font-size: 11.5px; font-weight: 650; color: var(--dsw-alias-fg-primary); }
.fly-eg-md-p { margin: 4px 0; line-height: 1.65; }
.fly-eg-md-list { margin: 4px 0; padding-left: 18px; line-height: 1.65; }
/* 报告里 "reproducible steps" 之后的有序列表带单条复制（renderMarkdown 认出该行后打标）。 */
.fly-eg-md-steps { padding-left: 20px; }
.fly-eg-md-list li { margin: 1px 0; }
.fly-eg-md-code { font-family: ui-monospace, Menlo, monospace; font-size: 10.5px; background: rgba(255, 255, 255, 0.06); padding: 0 4px; border-radius: 4px; overflow-wrap: anywhere; }
.fly-eg-report b { color: var(--dsw-alias-fg-primary); font-weight: 650; }
.fly-eg-report-actions { display: flex; gap: 6px; margin-top: 8px; }
.fly-eg-btn { font-size: 11.5px; padding: 3px 10px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-fg-primary); }

/* 图区的线走 SVG（按节点实测中心算），不用手摆坐标 —— 实现时同样按数据算 */
.fly-eg-wires { position: absolute; inset: 0; pointer-events: none; }

/* 连线走**折线**（elbow）：横向只占层间那一段，纵向在间隙里走 —— 比直线省横向空间。
   实现时同样用 SVG path（M/H/V 折角 + stroke-linejoin:round）。 */
.fly-eg-wire { fill: none; stroke: rgba(240, 165, 90, 0.55); stroke-width: 1.5; stroke-linejoin: round; stroke-linecap: round; }

/* ── 事实按来源工具折叠（<details>，缺省收起：长会话省地方） ── */
.fly-eg-group { border: 1px solid var(--dsw-alias-border-l1); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); margin-bottom: 4px; }
.fly-eg-group > summary { cursor: default; list-style: none; padding: 4px 8px; font-size: 11.5px; color: var(--dsw-alias-fg-secondary); display: flex; align-items: center; gap: 6px; }
.fly-eg-group > summary::-webkit-details-marker { display: none; }
.fly-eg-group > summary::before { content: '▸'; color: var(--dsw-alias-fg-muted); font-size: 10px; }
.fly-eg-group[open] > summary::before { content: '▾'; }
.fly-eg-group > summary b { color: var(--dsw-alias-fg-primary); font-weight: 600; }
.fly-eg-group > summary .fly-eg-count { margin-left: auto; font-size: 10.5px; color: var(--dsw-alias-fg-muted); }
.fly-eg-group table { margin: 0 0 2px; }

/* ── 会话作用域条：本会话 / 工作区 + 未归属认领 ── */
.fly-eg-scope { display: flex; align-items: center; gap: 8px; margin: 8px 0 2px; font-size: 11.5px; }
.fly-eg-scope-tab { padding: 2px 9px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-fg-secondary); cursor: default; }
.fly-eg-scope-tab.is-active { border-color: rgba(240, 165, 90, 0.55); background: rgba(240, 165, 90, 0.14); color: #ffd7b0; }
.fly-eg-scope-count { color: var(--dsw-alias-fg-muted); font-size: 10.5px; }
.fly-eg-adopt { margin-left: auto; border-color: rgba(240, 165, 90, 0.45); }
.fly-eg-scope-badge { font-size: 10.5px; padding: 1px 7px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l1); color: var(--dsw-alias-fg-muted); }
.fly-eg-hint { display: block; margin-top: 3px; font-size: 10.5px; color: var(--dsw-alias-fg-muted); }
.fly-eg-link { color: var(--fly-accent); cursor: default; }

.fly-eg-input { width: 100%; font: inherit; font-size: 11.5px; padding: 3px 8px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-fg-primary); }
.fly-eg-error { margin: 8px 0; padding: 6px 9px; border-radius: 8px; border: 1px solid rgba(255,95,109,0.45); background: rgba(255,95,109,0.10); color: #ffb8be; font-size: 11.5px; }
.fly-eg-empty { margin: 14px 0; color: var(--dsw-alias-fg-muted); font-size: 11.5px; }
`

interface Fact { id: string; kind?: string; target?: string; detail: string; source?: { tool?: string; operation?: string } }
interface Finding { id: string; title: string; severity?: string; description?: string; reproducibleSteps: string[]; affectedAssetId?: string }
interface Asset { id: string; type: string; value: string; parentId?: string }
interface Edge { kind: string; from: string; to: string }
interface Counts { facts: number; findings: number; assets: number; edges: number }
interface Projection {
  goal: { target: string; objective: string; authorization?: string } | null
  facts: Fact[]; findings: Finding[]; assets: Asset[]; edges: Edge[]
  counts: Counts
  workspaceCounts: Counts
  legacy: { facts: number; findings: number; assets: number; goal: number }
  scope: 'session' | 'workspace'
  session: string | null
  dropped: number; refused: number; skipped: number; truncated: boolean
}
interface StatePayload { workspace: string; ledger: string; window: number; session: string | null; scope: 'session' | 'workspace'; projection: Projection }

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(path + ' → HTTP ' + response.status)
  return await response.json() as T
}

const REPORT_PREVIEW_CAP = 20000
/** 复制文本：clipboard 优先，非安全上下文/权限被拒时回落 execCommand。返回是否成功。 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    let ok = true
    try {
      document.execCommand('copy')
    } catch {
      ok = false
    }
    area.remove()
    return ok
  }
}

/** 一步复现命令：行尾 ⧉ 单条复制。表格与报告共用同一个组件。 */
function StepItem({ step }: { step: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <li className="fly-eg-step">
      <code className="fly-eg-step-text">{step}</code>
      <button className="fly-eg-step-copy" title="复制此步" onClick={() => void (async () => {
        if (await copyText(step)) {
          setCopied(true)
          window.setTimeout(() => setCopied(false), 1200)
        }
      })()}>{copied ? '✓' : '⧉'}</button>
    </li>
  )
}



/** 行内子集：`code`、**bold**。文本走 React 节点（不拼 HTML），天然转义、无 XSS 面。 */
function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  // `_em_` 采取**保守**匹配：两侧必须是非单词字符（起止/标点/中文），内容不跨下划线。
  // 这样 web_access_tool、sha256_hash 这类标识符不会被误斜体；`_(source: …)_` 仍正常斜体。
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(?:(?<=^|[^\w])_([^_]+)_(?![\w]))/g
  let cursor = 0
  let index = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index > cursor) out.push(text.slice(cursor, match.index))
    const token = match[0]
    const key = keyPrefix + '-i' + index++
    if (token.startsWith('`')) out.push(<code key={key} className="fly-eg-md-code">{token.slice(1, -1)}</code>)
    else if (token.startsWith('**')) out.push(<b key={key}>{token.slice(2, -2)}</b>)
    else out.push(<i key={key}>{token.slice(1, -1)}</i>)
    cursor = match.index + token.length
  }
  if (cursor < text.length) out.push(text.slice(cursor))
  return out
}

/**
 * 报告 Markdown → React 节点。renderReport 的输出是受控子集：
 * `# / ## / ###` 标题、`- ` 与 `1. ` 列表、行内 `code`、`**bold**`、段落。
 * 刻意**不引入** markdown 库：子集稳定且由本包自己生成，一个 60 行渲染器比一个依赖更可控。
 */
function renderMarkdown(text: string): ReactNode[] {
  const blocks: ReactNode[] = []
  const paragraph: string[] = []
  let list: { ordered: boolean; items: { raw: string; content: ReactNode[] }[] } | null = null
  let stepsNext = false
  const flushParagraph = () => {
    if (paragraph.length === 0) return
    const key = 'p' + blocks.length
    const text = paragraph.join(' ')
    // 「reproducible steps (N):」之后紧跟的那个列表，渲染成勾选清单。
    if (/^reproducible steps/i.test(text)) stepsNext = true
    blocks.push(<p key={key} className="fly-eg-md-p">{renderInline(text, key)}</p>)
    paragraph.length = 0
  }
  const flushList = () => {
    if (list === null) return
    const key = 'l' + blocks.length
    const asSteps = stepsNext && list.ordered
    const items = list.items.map((item, i) => asSteps
      ? <StepItem key={key + '-' + i} step={item.raw} />
      : <li key={key + '-' + i}>{item.content}</li>)
    const className = asSteps ? 'fly-eg-md-list fly-eg-md-steps' : 'fly-eg-md-list'
    stepsNext = false
    blocks.push(list.ordered
      ? <ol key={key} className={className}>{items}</ol>
      : <ul key={key} className={className}>{items}</ul>)
    list = null
  }
  for (const line of text.split('\n')) {
    const heading = /^(#{1,3})\s+(.*)$/.exec(line)
    const bullet = /^[-*]\s+(.*)$/.exec(line)
    const ordered = /^\d+\.\s+(.*)$/.exec(line)
    if (heading !== null) {
      flushParagraph()
      flushList()
      stepsNext = false
      const key = 'h' + blocks.length
      const content = renderInline(heading[2], key)
      const level = heading[1].length
      blocks.push(level === 1 ? <h1 key={key} className="fly-eg-md-h1">{content}</h1>
        : level === 2 ? <h2 key={key} className="fly-eg-md-h2">{content}</h2>
          : <h3 key={key} className="fly-eg-md-h3">{content}</h3>)
      continue
    }
    if (bullet !== null || ordered !== null) {
      flushParagraph()
      const isOrdered = ordered !== null
      const raw = (bullet ?? ordered)![1]
      const content = renderInline(raw, 'i' + blocks.length + '-' + (list?.items.length ?? 0))
      if (list === null || list.ordered !== isOrdered) {
        flushList()
        list = { ordered: isOrdered, items: [] }
      }
      list.items.push({ raw, content })
      continue
    }
    if (line.trim() === '') {
      flushParagraph()
      flushList()
      continue
    }
    paragraph.push(line.trim())
  }
  flushParagraph()
  flushList()
  return blocks
}

/**
 * 资产深度：沿父链上溯（带环保护）。层级不限于两层，多级目录都自适应。
 * 父关系有两个来源，取并集：行上的 `parentId` 字段，**以及 `parent` 边（from 是父、to 是子）**
 * —— 记录方式不同（只写边 / 只写字段 / 两者都写）都要能排对层级。
 */
function assetDepth(
  assets: { id: string; parentId?: string }[],
  parentEdges: { from: string; to: string }[],
  id: string,
): number {
  const parentOf = new Map<string, string>()
  for (const edge of parentEdges) parentOf.set(edge.to, edge.from)
  for (const asset of assets) if (asset.parentId !== undefined && asset.parentId !== '') parentOf.set(asset.id, asset.parentId)
  const seen = new Set<string>([id])
  let depth = 0
  let cursor = parentOf.get(id)
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor)
    depth += 1
    cursor = parentOf.get(cursor)
  }
  return depth
}

/** 证据图：静态分层 + **折线**（M/H/V）连接。
 *
 * 布局三条纪律（2026-10-24 修图后）：
 *   ① 列宽按**该层**最宽节点算（不是全局最宽），横向间隙固定 56px —— 长标题不再把每一列都撑开；
 *   ② 节点宽度封顶 240px，超出显示省略号，全文进 title 提示；
 *   ③ 连线端点用**节点自己的半宽**（xOf ± w(node)/2），线头顶到节点边缘；带箭头指示方向。
 * 容器放不下时横向滚动（.fly-eg-graph overflow-x:auto），不裁剪。
 */
function Graph({ nodes, edges, kind }: { nodes: { id: string; label: string; layer: number; tone?: string }[]; edges: Edge[]; kind: string }) {
  // 节点宽改「量出来的真宽」：先按估算宽渲染，useLayoutEffect 在浏览器绘制前量一次
  // offsetWidth 回填 —— 框刚好包住文字（短文本不再留白），列宽与线头仍贴边。
  const nodeRefs = useRef(new Map<string, HTMLElement>())
  const [widths, setWidths] = useState<ReadonlyMap<string, number>>(new Map())
  useLayoutEffect(() => {
    const next = new Map<string, number>()
    let changed = widths.size !== nodes.length
    for (const node of nodes) {
      const width = nodeRefs.current.get(node.id)?.offsetWidth ?? 0
      if (width <= 0) continue
      next.set(node.id, width)
      if (widths.get(node.id) !== width) changed = true
    }
    if (changed) setWidths(next)
  })
  const byLayer = new Map<number, typeof nodes>()
  for (const node of nodes) {
    const list = byLayer.get(node.layer) ?? []
    list.push(node)
    byLayer.set(node.layer, list)
  }
  const layers = [...byLayer.keys()].sort((a, b) => a - b)
  const NODE_MAX = 240
  const NODE_MIN = 88
  // CJK 字宽约 11.5px、ASCII 约 6.4px（11.5px 字号）—— 混排标题按字型估，省略号才截在真宽附近。
  const textW = (label: string) => {
    let width = 22
    for (const ch of label) width += /[\u3000-\u9fff\uff01-\uff60]/.test(ch) ? 11.5 : 6.4
    return Math.min(NODE_MAX, Math.max(NODE_MIN, Math.round(width)))
  }
  const nodeW = new Map<string, number>()
  for (const node of nodes) nodeW.set(node.id, widths.get(node.id) ?? textW(node.label))
  const colW = new Map<number, number>()
  for (const node of nodes) colW.set(node.layer, Math.max(colW.get(node.layer) ?? 0, nodeW.get(node.id) ?? 0))
  const colGap = 56
  const xOf = new Map<string, number>()
  let cursor = 16
  for (const layer of layers) {
    const w = colW.get(layer) ?? NODE_MIN
    for (const node of byLayer.get(layer) ?? []) xOf.set(node.id, cursor + w / 2)
    cursor += w + colGap
  }
  const totalWidth = Math.round(cursor - colGap + 16)
  const rowPitch = 40
  const height = Math.max(96, ...layers.map(layer => (byLayer.get(layer) ?? []).length * rowPitch))
  const yOf = new Map<string, number>()
  for (const layer of layers) {
    const list = byLayer.get(layer) ?? []
    list.forEach((node, index) => yOf.set(node.id, (height / (list.length + 1)) * (index + 1)))
  }
  const markerId = 'fly-eg-arrow-' + kind
  return (
    <div className="fly-eg-graph" style={{ height: height + 34 }}>
      <div className="fly-eg-canvas" style={{ width: totalWidth, height: height + 34 }}>
        <svg className="fly-eg-wires" width={totalWidth} height={height + 34} viewBox={`0 0 ${totalWidth} ${height + 34}`}>
          <defs>
            <marker id={markerId} markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto" markerUnits="userSpaceOnUse">
              <path d="M0,0.6 L6,3.5 L0,6.4 z" fill="rgba(240, 165, 90, 0.85)" />
            </marker>
          </defs>
          {edges.filter(edge => xOf.has(edge.from) && xOf.has(edge.to)).map(edge => {
            const w1 = nodeW.get(edge.from) ?? NODE_MIN
            const w2 = nodeW.get(edge.to) ?? NODE_MIN
            const cx1 = xOf.get(edge.from) ?? 0
            const cx2 = xOf.get(edge.to) ?? 0
            const y1 = yOf.get(edge.from) ?? 0
            const y2 = yOf.get(edge.to) ?? 0
            let d: string
            if (cx2 > cx1) {
              // 跨列（左 → 右）：从源右边缘出发，折线走到目标左边缘。
              const x1 = cx1 + w1 / 2 + 3
              const x2 = cx2 - w2 / 2 - 3
              const midX = (x1 + x2) / 2
              d = 'M ' + x1 + ' ' + y1 + ' H ' + midX + ' V ' + y2 + ' H ' + x2
            } else {
              // 同列（背线）：从源右边缘出去，绕底道，从目标左边缘进来 —— 绝不横穿节点。
              const x1 = cx1 + w1 / 2 + 3
              const x2 = cx2 - w2 / 2 - 3
              const floor = height + 16
              d = 'M ' + x1 + ' ' + y1 + ' H ' + (x1 + 14) + ' V ' + floor + ' H ' + (x2 - 14) + ' V ' + y2 + ' H ' + x2
            }
            return <path key={kind + edge.from + edge.to} className="fly-eg-wire" markerEnd={`url(#${markerId})`} d={d} />
          })}
        </svg>
        {nodes.map(node => (
          <div key={node.id}
            ref={element => { if (element !== null) nodeRefs.current.set(node.id, element); else nodeRefs.current.delete(node.id) }}
            className={'fly-eg-node' + (node.tone === 'finding' ? ' is-finding' : node.tone === 'asset' ? ' is-asset' : '')}
            style={{ left: xOf.get(node.id), top: yOf.get(node.id) }}>{node.label}</div>
        ))}
      </div>
      <div className="fly-eg-graph-hint">折线走层间间隙 · 静态分层 · 只读</div>
    </div>
  )
}

function Panel({ sessionId, useSessions }: {
  sessionId?: string
  useSessions?: <T>(selector: (state: { byId: Record<string, { cwd?: string } | undefined> }) => T) => T
}) {
  const [override, setOverride] = useState<string>(() => localStorage.getItem(STORE_KEY) ?? '')
  const liveCwd = useSessions === undefined || sessionId === undefined
    ? undefined
    : useSessions(state => state.byId[sessionId]?.cwd)
  const workspace = override.trim() !== '' ? override : (liveCwd ?? '')
  const session = sessionId ?? ''
  const [scope, setScope] = useState<'session' | 'workspace'>('session')
  const [state, setState] = useState<StatePayload | null>(null)
  const [error, setError] = useState<string>('')
  const [view, setView] = useState<'table' | 'graph'>('table')
  const [report, setReport] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)

  const copyReport = async () => {
    if (report === '') return
    if (await copyText(report)) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1600)
    } else {
      setError('复制失败：浏览器拒绝了剪贴板写入')
    }
  }

  const load = useCallback(async (target: string, mode: 'session' | 'workspace') => {
    if (target.trim() === '') return
    setError('')
    const query = 'workspace=' + encodeURIComponent(target) + '&session=' + encodeURIComponent(session) + '&scope=' + mode
    try {
      const [next, rendered] = await Promise.all([
        getJson<StatePayload>(BASE + '/state?' + query),
        getJson<{ markdown: string }>(BASE + '/report?' + query).catch(() => ({ markdown: '' })),
      ])
      setState(next)
      setReport(rendered.markdown)
    } catch (failure) {
      const message = String((failure as Error).message ?? failure)
      setError(message.includes('HTTP 404')
        ? '宿主没有注册 ' + BASE + ' 路由（面板行未激活）· 重启 DSH 或重载 profile 后再试 · ' + message
        : message)
      setState(null)
    }
  }, [session])

  // 会话切换 / 作用域切换 / 工作区变化都重新读；不用轮询，靠可见性与焦点唤醒。
  useEffect(() => { void load(workspace, scope) }, [load, workspace, scope])
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') void load(workspace, scope) }
    document.addEventListener('visibilitychange', refresh)
    window.addEventListener('focus', refresh)
    return () => {
      document.removeEventListener('visibilitychange', refresh)
      window.removeEventListener('focus', refresh)
    }
  }, [load, workspace, scope])

  const adopt = async () => {
    if (busy || workspace.trim() === '' || session === '') return
    setBusy(true)
    try {
      const response = await fetch(BASE + '/adopt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ workspace, session, all: true }),
      })
      if (!response.ok) throw new Error('adopt → HTTP ' + response.status)
      await load(workspace, scope)
    } catch (failure) {
      setError(String((failure as Error).message ?? failure))
    } finally {
      setBusy(false)
    }
  }

  const projection = state?.projection
  // 宿主还没热重载时（旧 index.js 不返回 legacy/workspaceCounts），降级成 v1 读数而不是崩掉。
  const legacy = projection?.legacy ?? { facts: 0, findings: 0, assets: 0, goal: 0 }
  const totals = projection?.workspaceCounts ?? projection?.counts
  const legacyTotal = legacy.facts + legacy.findings + legacy.assets + legacy.goal
  const scopedTotal = projection === undefined ? 0 : projection.counts.facts + projection.counts.findings + projection.counts.assets
  const workspaceTotal = totals === undefined ? 0 : totals.facts + totals.findings + totals.assets
  const groups = useMemo(() => {
    const map = new Map<string, Fact[]>()
    for (const fact of projection?.facts ?? []) {
      const tool = fact.source?.tool ?? '(unknown tool)'
      map.set(tool, [...(map.get(tool) ?? []), fact])
    }
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [projection])

  return (
    <section className="fly-eg-panel">
      <div className="fly-eg-head">
        <div className="fly-eg-title">
          <h1>Engagement</h1>
          <span className="fly-eg-scope-badge">{session === '' ? '未绑定会话' : '会话 ' + session.slice(0, 8)}</span>
          {projection?.goal === null || projection === undefined ? null : <span className="fly-eg-badge">{projection.goal.target}</span>}
        </div>
        <div className="fly-eg-meta">
          <input className="fly-eg-input" value={workspace} placeholder="工作区绝对路径（默认跟随当前会话 cwd）"
            onChange={event => setOverride(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter') return
              localStorage.setItem(STORE_KEY, override)
              void load(workspace, scope)
            }} />
          {override.trim() === '' && liveCwd !== undefined && liveCwd !== '' ? <span className="fly-eg-hint">跟随会话 cwd · 输入可覆盖</span> : null}
        </div>
        {projection?.goal === null || projection === undefined ? null : (
          <>
            <div className="fly-eg-meta"><span>objective: {projection.goal.objective}</span></div>
            <div className="fly-eg-auth">authorization: <b>{projection.goal.authorization === undefined || projection.goal.authorization === '' ? '（未记录）' : projection.goal.authorization}</b> · 审计事实，不是门禁</div>
          </>
        )}
      </div>
      {error !== '' ? <div className="fly-eg-error">{error}</div> : null}
      {projection === undefined ? (
        <div className="fly-eg-empty">还没读取记录（填工作区后回车）</div>
      ) : (
        <>
          <div className="fly-eg-scope">
            <span className={'fly-eg-scope-tab' + (scope === 'session' ? ' is-active' : '')} onClick={() => setScope('session')}>本会话</span>
            <span className={'fly-eg-scope-tab' + (scope === 'workspace' ? ' is-active' : '')} onClick={() => setScope('workspace')}>工作区</span>
            <span className="fly-eg-scope-count">工作区合计 {workspaceTotal} 条</span>
            {legacyTotal > 0 && session !== '' ? (
              <button className="fly-eg-btn fly-eg-adopt" disabled={busy} onClick={() => void adopt()}>
                {busy ? '认领中…' : '认领 ' + legacyTotal + ' 条未归属记录'}
              </button>
            ) : null}
          </div>
          {scopedTotal === 0 ? (
            <div className="fly-eg-empty">
              {scope === 'session'
                ? (workspaceTotal > 0 ? '本会话还没有记录；工作区共 ' + workspaceTotal + ' 条' : '本会话还没有记录')
                : '这个工作区还没有记录'}
              {scope === 'session' && workspaceTotal > 0
                ? <span className="fly-eg-link" onClick={() => setScope('workspace')}> 看工作区 →</span>
                : null}
            </div>
          ) : null}
          <div className="fly-eg-counters">
            <span className="fly-eg-counter">facts<b>{projection.counts.facts}</b></span>
            <span className="fly-eg-counter">findings<b>{projection.counts.findings}</b></span>
            <span className="fly-eg-counter">assets<b>{projection.counts.assets}</b></span>
            <span className="fly-eg-counter">edges<b>{projection.counts.edges}</b></span>
            <span className={'fly-eg-counter' + (projection.dropped > 0 ? ' is-warn' : '')}>dropped<b>{projection.dropped}</b></span>
            <span className={'fly-eg-counter' + (projection.refused > 0 ? ' is-warn' : '')}>refused<b>{projection.refused}</b></span>
          </div>
          <div className="fly-eg-tabs">
            <span className={'fly-eg-tab' + (view === 'table' ? ' is-active' : '')} onClick={() => setView('table')}>表</span>
            <span className={'fly-eg-tab' + (view === 'graph' ? ' is-active' : '')} onClick={() => setView('graph')}>图</span>
          </div>
          {view === 'table' ? (
            <>
              <div className="fly-eg-section"><h2>Assets</h2>
                <table className="fly-eg-table"><tbody>
                  {projection.assets.map(asset => <tr key={asset.id}><td className="fly-eg-id">{asset.id}</td><td>{asset.type}</td><td>{asset.value}</td><td className="fly-eg-src">{asset.parentId ?? '—'}</td></tr>)}
                </tbody></table>
              </div>
              <div className="fly-eg-section"><h2>Findings</h2>
                <table className="fly-eg-table"><tbody>
                  {projection.findings.map(finding => (
                    <tr key={finding.id}>
                      <td className="fly-eg-id">{finding.id}</td>
                      <td><span className={'fly-eg-sev ' + (finding.severity ?? 'info')}>{finding.severity ?? 'info'}</span></td>
                      <td>{finding.title}</td>
                      <td><ol className="fly-eg-steps">{finding.reproducibleSteps.map((step, index) => <StepItem key={index} step={step} />)}</ol></td>
                    </tr>
                  ))}
                </tbody></table>
              </div>
              <div className="fly-eg-section"><h2>Facts · by source tool</h2>
                {groups.map(([tool, facts], index) => (
                  <details className="fly-eg-group" key={tool} open={index === 0}>
                    <summary><b>{tool}</b><span className="fly-eg-count">{facts.length} 条</span></summary>
                    <table className="fly-eg-table"><tbody>
                      {facts.map(fact => <tr key={fact.id}><td className="fly-eg-id">{fact.id}</td><td>{fact.detail}</td></tr>)}
                    </tbody></table>
                  </details>
                ))}
              </div>
              <div className="fly-eg-section">
                <div className="fly-eg-section-head">
                  <h2>Report</h2>
                  <button className={'fly-eg-copy' + (copied ? ' is-done' : '')} disabled={report === ''} onClick={() => void copyReport()}>
                    {copied ? '已复制 ✓' : '复制 Markdown'}
                  </button>
                </div>
                <div className="fly-eg-report">{report === '' ? '（还没有可渲染的报告）' : renderMarkdown(report.length > REPORT_PREVIEW_CAP ? report.slice(0, REPORT_PREVIEW_CAP) + '\n\n**…（报告超过 ' + REPORT_PREVIEW_CAP + ' 字符，已截断预览）**' : report)}</div>
              </div>
            </>
          ) : (
            <>
              <div className="fly-eg-section"><h2>Evidence graph</h2>
                <Graph kind="proves"
                  nodes={[
                    ...projection.facts.map((fact, index) => ({ id: fact.id, label: fact.id + ' ' + (fact.kind ?? 'info'), layer: 0, tone: undefined })),
                    ...projection.findings.map(finding => ({ id: finding.id, label: finding.id + ' ' + finding.title, layer: 1, tone: 'finding' })),
                  ]}
                  edges={projection.edges.filter(edge => edge.kind === 'proves' || edge.kind === 'derived_from')} />
              </div>
              <div className="fly-eg-section"><h2>Asset tree</h2>
                <Graph kind="parent"
                  nodes={projection.assets.map(asset => ({ id: asset.id, label: asset.value + ' (' + asset.type + ')', layer: assetDepth(projection.assets, projection.edges.filter(edge => edge.kind === 'parent'), asset.id), tone: 'asset' }))}
                  edges={projection.edges.filter(edge => edge.kind === 'parent')} />
              </div>
            </>
          )}
        </>
      )}
    </section>
  )
}

export function EngagementMark({ size = 18, active = false }: { size?: number; active?: boolean }) {
  return (
    <svg className="fly-mark" data-active={active ? 'true' : 'false'} width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="6" cy="6" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="18" cy="12" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <circle cx="6" cy="18" r="2.2" stroke="currentColor" strokeWidth="1.6" />
      <path d="M8 7l8 4M8 17l8-4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  )
}

export function apply(ctx: {
  effect(callback: () => void | (() => void), label?: string): void
  slots: {
    inject(name: string, callback: () => void | (() => void)): void
    register(options: { name: string; key?: string; inject?: () => unknown }, component: unknown): () => void
  }
  sidebarRightTabs: { register(definition: unknown): () => void }
}): void {
  ctx.effect(() => ctx.sidebarRightTabs.register({
    id: PACKAGE,
    kind: KIND,
    title: () => TAB_TITLE,
    guide: [{ id: 'open', order: GUIDE_ORDER, title: () => TAB_TITLE, description: () => TAB_DESCRIPTION, icon: EngagementMark }],
  }), 'fly-engagement-panel: drawer type')

  ctx.effect(() => {
    const tag = document.createElement('style')
    tag.setAttribute('data-plugin', PACKAGE)
    tag.textContent = PANEL_CSS
    document.head.appendChild(tag)
    return () => { tag.remove() }
  }, 'fly-engagement-panel: panel stylesheet')

  ctx.effect(() => ctx.slots.inject('sidebar.right.pane.tab', () => ctx.slots.register(
    { name: 'sidebar.right.pane.tab', key: PACKAGE, inject: () => ({}) },
    Panel,
  )), 'fly-engagement-panel: drawer body')
}
