/**
 * engagement 记录的**纯函数层** —— 工具半边（agent 平面）与面板半边（宿主行）共用一份。
 *
 * 为什么单独成文件：这两半是两个挂载点（`tools/index.js` 由 preset 按会话挂；根 `index.js`
 * 是宿主平面的面板行），**投影口径必须逐字一致**，否则面板上的计数和 `eng_state` 会讲两个故事。
 * 同包内 import ⇒ 不需要"两份逐字节相同"的钉子（那是跨包才付的代价）。
 *
 * v2 起事件带 `session`：一个工作区一条账本，但**每个会话各自一条证据链**。
 * 没有 session 的旧事件归入「未归属」（v1 遗留），可以经 `eng_adopt` 认领。
 */

export const FACT_KINDS = ['net', 'service', 'http', 'binary', 'code', 'vuln', 'info']
export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info']
export const ASSET_TYPES = ['host', 'ip', 'port', 'service', 'url', 'file', 'binary', 'process']
export const EDGE_KINDS = ['parent', 'proves', 'derived_from']

export const LEDGER_DIR = '.fly-engagement'
export const LEDGER_FILE = 'events.jsonl'

/** `<workspace>/.fly-engagement/events.jsonl`（工作区路径尾斜杠无所谓）。 */
export function ledgerPath(workspace) {
  return String(workspace).replace(/\/+$/u, '') + '/' + LEDGER_DIR + '/' + LEDGER_FILE
}

/** 事件信封上的会话身份：缺省 / 空串都折成 null（= v1 遗留的未归属）。 */
export function sessionOf(event) {
  return typeof event?.session === 'string' && event.session !== '' ? event.session : null
}

/**
 * 折叠事件流 ⇒ 完整状态（**确定性**：同一个文件永远折出同一张图）。
 * 坏引用计入 `refused`（不是静默丢弃）；认领别人的记录计入 `skipped`。
 */
export function foldEvents(lines) {
  const state = { goals: [], facts: [], findings: [], assets: [], edges: [], refused: 0, skipped: 0 }
  const allRows = () => new Map([...state.facts, ...state.findings, ...state.assets].map(row => [row.id, row]))
  for (const line of lines) {
    if (line.trim() === '') continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      state.refused += 1
      continue
    }
    if (event.op === 'goal') {
      const session = sessionOf(event)
      if (state.goals.some(row => row.session === session)) { state.refused += 1; continue }
      state.goals.push({ session, goal: event.goal, at: event.at ?? null })
      continue
    }
    if (event.op === 'adopt') {
      const session = sessionOf(event)
      if (session === null) { state.refused += 1; continue }
      const rows = allRows()
      for (const id of event.ids ?? []) {
        const row = rows.get(id)
        if (row === undefined) { state.refused += 1; continue }
        if ((row.session ?? null) !== null) { state.skipped += 1; continue }
        row.session = session
      }
      if (event.goal === true) {
        const legacy = state.goals.find(row => row.session === null)
        if (legacy === undefined || state.goals.some(row => row.session === session)) state.skipped += 1
        else legacy.session = session
      }
      // 边跟着端点走：两端都归本会话的未归属边一起认领（保持账本内部一致；渲染不依赖这一步）。
      for (const edge of state.edges) {
        if ((edge.session ?? null) !== null) continue
        const from = rows.get(edge.from)
        const to = rows.get(edge.to)
        if (from !== undefined && to !== undefined && from.session === session && to.session === session) edge.session = session
      }
      continue
    }
    if (event.op !== 'record') continue
    const session = sessionOf(event)
    const ids = new Set(allRows().keys())
    for (const asset of event.assets ?? []) {
      if (asset.parentId !== undefined && asset.parentId !== '' && !ids.has(asset.parentId)) { state.refused += 1; continue }
      state.assets.push({ ...asset, session })
      ids.add(asset.id)
    }
    for (const fact of event.facts ?? []) {
      state.facts.push({ ...fact, session })
      ids.add(fact.id)
    }
    for (const finding of event.findings ?? []) {
      if (finding.affectedAssetId !== undefined && finding.affectedAssetId !== '' && !ids.has(finding.affectedAssetId)) { state.refused += 1; continue }
      state.findings.push({ ...finding, session })
      ids.add(finding.id)
    }
    for (const edge of event.edges ?? []) {
      if (!ids.has(edge.from) || !ids.has(edge.to)) { state.refused += 1; continue }
      state.edges.push({ ...edge, session })
    }
  }
  return state
}

/** 某个会话的 goal（`session` 为 null 即 v1 遗留）。 */
export function goalFor(state, session) {
  return state.goals.find(row => row.session === (session ?? null))?.goal ?? null
}

const countsOf = rows => ({
  facts: rows.facts.length,
  findings: rows.findings.length,
  assets: rows.assets.length,
  edges: rows.edges.length,
})

/**
 * 作用域视图：`scope='session'` 只留该会话的行，`scope='workspace'` 合并全部。
 *
 * 两个读数永远都给：`counts` 是**当前作用域**的计数，`workspaceCounts` 是全工作区的。
 * `legacy` 单独报未归属条数（v1 遗留），面板据此决定要不要给「认领」按钮。
 */
export function scopeView(state, options = {}, windowSize = 200) {
  const scope = options.scope === 'workspace' ? 'workspace' : 'session'
  const session = scope === 'session' ? (options.session ?? null) : null
  const inScope = row => scope === 'workspace' || (row.session ?? null) === session
  const cut = rows => rows.length <= windowSize
    ? { rows, dropped: 0 }
    : { rows: rows.slice(rows.length - windowSize), dropped: rows.length - windowSize }

  const factsAll = state.facts.filter(inScope)
  const findingsAll = state.findings.filter(inScope)
  const assetsAll = state.assets.filter(inScope)
  // 边**跟随端点**：两端都在作用域内才算这条作用域的边（边自己的 session 只是出处，
  // 不参与过滤 —— 否则 adopt 只认领节点后，边会以未归属身份残留、图上看不到连线）。
  const scopedIds = new Set([...factsAll, ...findingsAll, ...assetsAll].map(row => row.id))
  const edgesAll = state.edges.filter(edge => scopedIds.has(edge.from) && scopedIds.has(edge.to))
  const facts = cut(factsAll)
  const findings = cut(findingsAll)
  const assets = cut(assetsAll)
  const kept = new Set([...facts.rows, ...findings.rows, ...assets.rows].map(row => row.id))
  const dropped = facts.dropped + findings.dropped + assets.dropped
  const scoped = {
    facts: facts.rows,
    findings: findings.rows,
    assets: assets.rows,
    edges: edgesAll.filter(edge => kept.has(edge.from) && kept.has(edge.to)),
  }
  const goals = scope === 'workspace' ? state.goals : state.goals.filter(row => row.session === session)
  return {
    ...scoped,
    scope,
    session,
    goal: goals.length === 1 ? goals[0].goal : null,
    goals: goals.map(row => ({ session: row.session, goal: row.goal })),
    counts: countsOf({ facts: factsAll, findings: findingsAll, assets: assetsAll, edges: edgesAll }),
    workspaceCounts: countsOf(state),
    legacy: {
      facts: state.facts.filter(row => (row.session ?? null) === null).length,
      findings: state.findings.filter(row => (row.session ?? null) === null).length,
      assets: state.assets.filter(row => (row.session ?? null) === null).length,
      goal: state.goals.filter(row => row.session === null).length,
    },
    dropped,
    refused: state.refused,
    skipped: state.skipped,
    truncated: dropped > 0,
  }
}

/** 兼容旧调用：整份账本的窗口视图。 */
export function windowView(state, windowSize) {
  return scopeView(state, { scope: 'workspace' }, windowSize)
}

/** 下一个确定性 id `<kind>-<n>`。 */
export function nextId(prefix, rows) {
  let max = 0
  for (const row of rows) {
    const match = new RegExp('^' + prefix + '-(\\d+)$', 'u').exec(row.id)
    if (match !== null) max = Math.max(max, Number(match[1]))
  }
  return prefix + '-' + (max + 1)
}

/** 从视图渲染 Markdown 报告（`eng_report` 与 `/fly/engagement/report` 同一份）。 */
export function renderReport(workspace, view) {
  const lines = []
  const scopeLabel = view.scope === 'workspace' ? '整个工作区' : '会话 ' + (view.session ?? '（未归属）')
  lines.push('# Engagement report')
  lines.push('')
  lines.push('- workspace: `' + workspace + '`')
  lines.push('- ledger: `' + ledgerPath(workspace) + '`')
  lines.push('- scope: ' + scopeLabel)
  lines.push('- counts: facts=' + view.counts.facts + ' findings=' + view.counts.findings + ' assets=' + view.counts.assets + ' edges=' + view.counts.edges)
  if (view.scope === 'session') lines.push('- workspace totals: facts=' + view.workspaceCounts.facts + ' findings=' + view.workspaceCounts.findings + ' assets=' + view.workspaceCounts.assets + ' edges=' + view.workspaceCounts.edges)
  if (view.refused > 0) lines.push('- refused writes: ' + view.refused + '（引用不存在的 id，已拒绝）')
  lines.push('', '## Goal', '')
  if (view.goal === null) {
    lines.push('**未设置（还没有 eng_record 带 goal）**')
  } else {
    lines.push('- target: ' + view.goal.target)
    lines.push('- objective: ' + view.goal.objective)
    lines.push('- authorization: ' + (view.goal.authorization === undefined || view.goal.authorization === '' ? '**未记录**（这是审计事实，不是门禁）' : view.goal.authorization))
  }
  lines.push('', '## Assets')
  if (view.assets.length === 0) lines.push('', 'none')
  for (const asset of view.assets) {
    const parent = asset.parentId === undefined || asset.parentId === '' ? '' : '  ← parent `' + asset.parentId + '`'
    lines.push('- `' + asset.id + '` [' + asset.type + '] ' + asset.value + parent)
  }
  lines.push('', '## Findings')
  if (view.findings.length === 0) lines.push('', 'none')
  for (const finding of view.findings) {
    lines.push('', '### `' + finding.id + '` ' + finding.title + ' — **' + (finding.severity ?? 'info') + '**')
    if (finding.description !== undefined && finding.description !== '') lines.push('', finding.description)
    if (finding.affectedAssetId !== undefined && finding.affectedAssetId !== '') lines.push('', 'affected asset: `' + finding.affectedAssetId + '`')
    lines.push('', 'reproducible steps (' + finding.reproducibleSteps.length + '):')
    for (const [index, step] of finding.reproducibleSteps.entries()) lines.push((index + 1) + '. ' + step)
  }
  lines.push('', '## Facts')
  if (view.facts.length === 0) lines.push('', 'none')
  for (const fact of view.facts) {
    const source = fact.source === undefined ? '' : '  _(source: ' + [fact.source.tool, fact.source.operation].filter(Boolean).join(' · ') + ')_'
    lines.push('- `' + fact.id + '` [' + (fact.kind ?? 'info') + ']' + (fact.target === undefined ? '' : ' ' + fact.target) + ' — ' + fact.detail + source)
  }
  lines.push('', '## Edges')
  if (view.edges.length === 0) lines.push('', 'none')
  for (const edge of view.edges) lines.push('- `' + edge.from + '` -[' + edge.kind + ']→ `' + edge.to + '`')
  lines.push('')
  return lines.join('\n')
}
