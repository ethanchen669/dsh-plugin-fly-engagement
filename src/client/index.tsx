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
import { useCallback, useEffect, useMemo, useState } from 'react'

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
:root {
  --dsw-alias-bg-base: #070b12;
  --dsw-alias-bg-layer-1: rgba(255, 255, 255, 0.045);
  --dsw-alias-bg-layer-2: rgba(255, 255, 255, 0.07);
  --dsw-alias-fg-primary: #e8eef8;
  --dsw-alias-fg-secondary: #9fb0c6;
  --dsw-alias-fg-muted: #6b7d95;
  --dsw-alias-border-l1: rgba(255, 255, 255, 0.10);
  --fly-accent: #f0a55a;
  --fly-accent-dim: rgba(240, 165, 90, 0.16);
  --fly-critical: #ff5f6d;
  --fly-high: #ff9b52;
  --fly-medium: #e8c54a;
  --fly-low: #6fc2ff;
  --fly-info: #8fa3bd;
}

* { box-sizing: border-box; }
body {
  margin: 0;
  padding: var(--fly-desk, 12px);
  background: #05080d;
  font: 13px/1.5 -apple-system, "SF Pro Text", "PingFang SC", system-ui, sans-serif;
  color: var(--dsw-alias-fg-primary);
}

/* ── 面板框：照 .fly-panel 的结构（rail 8px / 3px 亮缘 / 底部关系型亮缘） ── */
.fly-eg-panel {
  --fly-rail: 8px;
  width: 760px;
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
.fly-eg-table td { padding: 5px 6px; border-bottom: 1px solid rgba(255, 255, 255, 0.05); vertical-align: top; }
.fly-eg-id { font-family: ui-monospace, Menlo, monospace; font-size: 11px; color: var(--dsw-alias-fg-muted); }
.fly-eg-src { font-size: 11px; color: var(--dsw-alias-fg-muted); }
.fly-eg-src b { color: var(--dsw-alias-fg-secondary); font-weight: 500; }
.fly-eg-sev { font-size: 11px; font-weight: 600; padding: 1px 7px; border-radius: 999px; display: inline-block; }
.fly-eg-sev.critical { color: #fff; background: var(--fly-critical); }
.fly-eg-sev.high { color: #1a0f06; background: var(--fly-high); }
.fly-eg-sev.medium { color: #1a1506; background: var(--fly-medium); }
.fly-eg-sev.low { color: #061019; background: var(--fly-low); }
.fly-eg-sev.info { color: #0b1017; background: var(--fly-info); }
.fly-eg-steps { margin: 4px 0 0 0; padding-left: 18px; color: var(--dsw-alias-fg-secondary); font-size: 11.5px; }
.fly-eg-steps code, .fly-eg-cmd { font-family: ui-monospace, Menlo, monospace; font-size: 11px; background: rgba(255, 255, 255, 0.06); padding: 0 4px; border-radius: 4px; }

/* ── 图区：静态分层 + 边胶囊 + 只读（借 xyflow 的形状，不引入拖拽） ── */
.fly-eg-graph { position: relative; height: 300px; border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: radial-gradient(600px 240px at 50% 0%, rgba(255,255,255,0.035), transparent 70%), var(--dsw-alias-bg-layer-1); overflow: hidden; }
.fly-eg-graph-hint { position: absolute; left: 8px; bottom: 6px; font-size: 10.5px; color: var(--dsw-alias-fg-muted); }
.fly-eg-graph-badge { position: absolute; right: 8px; top: 8px; font-size: 10.5px; padding: 2px 7px; border-radius: 999px; border: 1px solid rgba(255, 95, 109, 0.45); background: rgba(255, 95, 109, 0.12); color: #ffb8be; }
.fly-eg-node { position: absolute; transform: translate(-50%, -50%); border-radius: 8px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-2); padding: 5px 9px; font-size: 11.5px; white-space: nowrap; }
.fly-eg-node.is-finding { border-color: rgba(255, 155, 82, 0.55); background: rgba(255, 155, 82, 0.14); color: #ffd7b0; }
.fly-eg-node.is-asset { border-color: rgba(111, 194, 255, 0.45); background: rgba(111, 194, 255, 0.12); color: #cbe8ff; }
.fly-eg-edge { position: absolute; height: 1.5px; background: rgba(240, 165, 90, 0.55); transform-origin: 0 50%; }
.fly-eg-edge-cap { position: absolute; font-size: 10px; color: var(--fly-accent); background: rgba(7, 11, 18, 0.85); padding: 0 4px; border-radius: 4px; border: 1px solid rgba(240, 165, 90, 0.3); }

/* ── 报告区 ── */
.fly-eg-report { border: 1px solid var(--dsw-alias-border-l1); border-radius: 10px; background: var(--dsw-alias-bg-layer-1); padding: 8px 10px; font-size: 11.5px; color: var(--dsw-alias-fg-secondary); }
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

.fly-eg-input { width: 100%; font: inherit; font-size: 11.5px; padding: 3px 8px; border-radius: 7px; border: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-fg-primary); }
.fly-eg-error { margin: 8px 0; padding: 6px 9px; border-radius: 8px; border: 1px solid rgba(255,95,109,0.45); background: rgba(255,95,109,0.10); color: #ffb8be; font-size: 11.5px; }
.fly-eg-empty { margin: 14px 0; color: var(--dsw-alias-fg-muted); font-size: 11.5px; }
`

interface Fact { id: string; kind?: string; target?: string; detail: string; source?: { tool?: string; operation?: string } }
interface Finding { id: string; title: string; severity?: string; description?: string; reproducibleSteps: string[]; affectedAssetId?: string }
interface Asset { id: string; type: string; value: string; parentId?: string }
interface Edge { kind: string; from: string; to: string }
interface Projection {
  goal: { target: string; objective: string; authorization?: string } | null
  facts: Fact[]; findings: Finding[]; assets: Asset[]; edges: Edge[]
  counts: { facts: number; findings: number; assets: number; edges: number }
  dropped: number; refused: number; truncated: boolean
}
interface StatePayload { workspace: string; ledger: string; window: number; projection: Projection }

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(path, { headers: { accept: 'application/json' } })
  if (!response.ok) throw new Error(path + ' → HTTP ' + response.status)
  return await response.json() as T
}

/** 证据图：静态分层 + **折线**（M/H/V）连接；层距按实测最宽节点算（间隙要放得下边胶囊）。 */
function Graph({ nodes, edges, kind }: { nodes: { id: string; label: string; layer: number; tone?: string }[]; edges: Edge[]; kind: string }) {
  const byLayer = new Map<number, typeof nodes>()
  for (const node of nodes) {
    const list = byLayer.get(node.layer) ?? []
    list.push(node)
    byLayer.set(node.layer, list)
  }
  const layers = [...byLayer.keys()].sort((a, b) => a - b)
  const widest = Math.max(120, ...nodes.map(node => node.label.length * 6.6 + 20))
  const gap = 78
  const xOf = new Map<string, number>()
  let cursor = 60
  for (const layer of layers) {
    for (const node of byLayer.get(layer) ?? []) xOf.set(node.id, cursor + widest / 2)
    cursor += widest + gap
  }
  const height = Math.max(180, ...layers.map(layer => (byLayer.get(layer) ?? []).length * 54))
  const yOf = new Map<string, number>()
  for (const layer of layers) {
    const list = byLayer.get(layer) ?? []
    list.forEach((node, index) => yOf.set(node.id, (height / (list.length + 1)) * (index + 1)))
  }
  return (
    <div className="fly-eg-graph" style={{ height: height + 60 }}>
      <svg className="fly-eg-wires" width="100%" height="100%">
        {edges.filter(edge => xOf.has(edge.from) && xOf.has(edge.to)).map(edge => {
          const x1 = (xOf.get(edge.from) ?? 0) + widest / 2
          const x2 = (xOf.get(edge.to) ?? 0) - widest / 2
          const midX = (x1 + x2) / 2
          return <path key={kind + edge.from + edge.to} className="fly-eg-wire" d={'M ' + x1 + ' ' + yOf.get(edge.from) + ' H ' + midX + ' V ' + yOf.get(edge.to) + ' H ' + x2} />
        })}
      </svg>
      {nodes.map(node => (
        <div key={node.id} className={'fly-eg-node' + (node.tone === 'finding' ? ' is-finding' : node.tone === 'asset' ? ' is-asset' : '')}
          style={{ left: xOf.get(node.id), top: yOf.get(node.id) }}>{node.label}</div>
      ))}
      <div className="fly-eg-graph-hint">折线走层间间隙 · 静态分层 · 只读</div>
    </div>
  )
}

function Panel() {
  const [workspace, setWorkspace] = useState<string>(() => localStorage.getItem(STORE_KEY) ?? '')
  const [state, setState] = useState<StatePayload | null>(null)
  const [error, setError] = useState<string>('')
  const [view, setView] = useState<'table' | 'graph'>('table')
  const [report, setReport] = useState<string>('')

  const load = useCallback(async (target: string) => {
    if (target.trim() === '') return
    setError('')
    try {
      const [next, rendered] = await Promise.all([
        getJson<StatePayload>(BASE + '/state?workspace=' + encodeURIComponent(target)),
        getJson<{ markdown: string }>(BASE + '/report?workspace=' + encodeURIComponent(target)).catch(() => ({ markdown: '' })),
      ])
      setState(next)
      setReport(rendered.markdown)
      localStorage.setItem(STORE_KEY, target)
    } catch (failure) {
      setError(String((failure as Error).message ?? failure))
      setState(null)
    }
  }, [])

  useEffect(() => { void load(workspace) }, [load, workspace])

  const projection = state?.projection
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
          {projection?.goal === null || projection === undefined ? null : <span className="fly-eg-badge">{projection.goal.target}</span>}
        </div>
        <div className="fly-eg-meta">
          <input className="fly-eg-input" value={workspace} placeholder="工作区绝对路径（记录在 <workspace>/.fly-engagement/events.jsonl）"
            onChange={event => setWorkspace(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void load(workspace) }} />
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
                      <td><ol className="fly-eg-steps">{finding.reproducibleSteps.map((step, index) => <li key={index}><code>{step}</code></li>)}</ol></td>
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
              <div className="fly-eg-section"><h2>Report</h2>
                <div className="fly-eg-report">{report === '' ? '（还没有可渲染的报告）' : report.slice(0, 2000)}</div>
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
                  nodes={projection.assets.map(asset => ({ id: asset.id, label: asset.value + ' (' + asset.type + ')', layer: asset.parentId === undefined ? 0 : 1, tone: 'asset' }))}
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
