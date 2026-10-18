/**
 * engagement 记录的**纯函数层** —— 工具半边（agent 平面）与面板半边（宿主行）共用一份。
 *
 * 为什么单独成文件：这两半是两个挂载点（`tools/index.js` 由 preset 按会话挂；根 `index.js`
 * 是宿主平面的面板行），**投影口径必须逐字一致**，否则面板上的计数和 `eng_state` 会讲两个故事。
 * 同包内 import ⇒ 不需要"两份逐字节相同"的钉子（那是跨包才付的代价）。
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

/**
 * 折叠事件流 ⇒ 完整状态（**确定性**：同一个文件永远折出同一张图）。
 * 坏引用计入 `refused`（不是静默丢弃）。
 */
export function foldEvents(lines) {
  const state = { goal: null, facts: [], findings: [], assets: [], edges: [], refused: 0 }
  const known = () => new Set([...state.facts.map(row => row.id), ...state.findings.map(row => row.id), ...state.assets.map(row => row.id)])
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
      if (state.goal !== null) { state.refused += 1; continue }
      state.goal = event.goal
      continue
    }
    if (event.op !== 'record') continue
    const ids = known()
    for (const asset of event.assets ?? []) {
      if (asset.parentId !== undefined && asset.parentId !== '' && !ids.has(asset.parentId)) { state.refused += 1; continue }
      state.assets.push(asset)
      ids.add(asset.id)
    }
    for (const fact of event.facts ?? []) {
      state.facts.push(fact)
      ids.add(fact.id)
    }
    for (const finding of event.findings ?? []) {
      if (finding.affectedAssetId !== undefined && finding.affectedAssetId !== '' && !ids.has(finding.affectedAssetId)) { state.refused += 1; continue }
      state.findings.push(finding)
      ids.add(finding.id)
    }
    for (const edge of event.edges ?? []) {
      if (!ids.has(edge.from) || !ids.has(edge.to)) { state.refused += 1; continue }
      state.edges.push(edge)
    }
  }
  return state
}

/**
 * 窗口视图：每张表留最新 `windowSize` 条；`dropped` 是被逐出的条数。
 * `counts` 报**全量**、窗口只影响 rows —— 两个读数都要在（面板与 `eng_state` 同口径）。
 */
export function windowView(state, windowSize) {
  const cut = rows => rows.length <= windowSize
    ? { rows, dropped: 0 }
    : { rows: rows.slice(rows.length - windowSize), dropped: rows.length - windowSize }
  const facts = cut(state.facts)
  const findings = cut(state.findings)
  const assets = cut(state.assets)
  const kept = new Set([...facts.rows, ...findings.rows, ...assets.rows].map(row => row.id))
  const dropped = facts.dropped + findings.dropped + assets.dropped
  return {
    goal: state.goal,
    facts: facts.rows,
    findings: findings.rows,
    assets: assets.rows,
    edges: state.edges.filter(edge => kept.has(edge.from) && kept.has(edge.to)),
    counts: { facts: state.facts.length, findings: state.findings.length, assets: state.assets.length, edges: state.edges.length },
    dropped,
    refused: state.refused,
    truncated: dropped > 0,
  }
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

/** 从全量状态渲染 Markdown 报告（`eng_report` 与 `/fly/engagement/report` 同一份）。 */
export function renderReport(workspace, state) {
  const lines = []
  lines.push('# Engagement report')
  lines.push('')
  lines.push('- workspace: `' + workspace + '`')
  lines.push('- ledger: `' + ledgerPath(workspace) + '`')
  lines.push('- counts: facts=' + state.facts.length + ' findings=' + state.findings.length + ' assets=' + state.assets.length + ' edges=' + state.edges.length)
  if (state.refused > 0) lines.push('- refused writes: ' + state.refused + '（引用不存在的 id，已拒绝）')
  lines.push('', '## Goal', '')
  if (state.goal === null) {
    lines.push('_未设置（还没有 eng_record 带 goal）_')
  } else {
    lines.push('- target: ' + state.goal.target)
    lines.push('- objective: ' + state.goal.objective)
    lines.push('- authorization: ' + (state.goal.authorization === undefined || state.goal.authorization === '' ? '_未记录_（这是审计事实，不是门禁）' : state.goal.authorization))
  }
  lines.push('', '## Assets')
  if (state.assets.length === 0) lines.push('', '_none_')
  for (const asset of state.assets) {
    const parent = asset.parentId === undefined || asset.parentId === '' ? '' : '  ← parent `' + asset.parentId + '`'
    lines.push('- `' + asset.id + '` [' + asset.type + '] ' + asset.value + parent)
  }
  lines.push('', '## Findings')
  if (state.findings.length === 0) lines.push('', '_none_')
  for (const finding of state.findings) {
    lines.push('', '### `' + finding.id + '` ' + finding.title + ' — **' + (finding.severity ?? 'info') + '**')
    if (finding.description !== undefined && finding.description !== '') lines.push('', finding.description)
    if (finding.affectedAssetId !== undefined && finding.affectedAssetId !== '') lines.push('', 'affected asset: `' + finding.affectedAssetId + '`')
    lines.push('', 'reproducible steps (' + finding.reproducibleSteps.length + '):')
    for (const [index, step] of finding.reproducibleSteps.entries()) lines.push((index + 1) + '. ' + step)
  }
  lines.push('', '## Facts')
  if (state.facts.length === 0) lines.push('', '_none_')
  for (const fact of state.facts) {
    const source = fact.source === undefined ? '' : '  _(source: ' + [fact.source.tool, fact.source.operation].filter(Boolean).join(' · ') + ')_'
    lines.push('- `' + fact.id + '` [' + (fact.kind ?? 'info') + ']' + (fact.target === undefined ? '' : ' ' + fact.target) + ' — ' + fact.detail + source)
  }
  lines.push('', '## Edges')
  if (state.edges.length === 0) lines.push('', '_none_')
  for (const edge of state.edges) lines.push('- `' + edge.from + '` -[' + edge.kind + ']→ `' + edge.to + '`')
  lines.push('')
  return lines.join('\n')
}
