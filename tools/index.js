import { defineTool } from '@deepseek-ai/dsh-tools'
import {
  ASSET_TYPES, EDGE_KINDS, FACT_KINDS, SEVERITIES,
  foldEvents, ledgerPath, nextId, renderReport, windowView,
} from '../lib/fold.mjs'

/**
 * fly-engagement —— **agent 平面**的工具半边（preset 行：`dsh-plugin-fly-engagement/tools/index.js`）。
 *
 * 记录写进工作区：`<workspace>/.fly-engagement/events.jsonl`（append-only，投影=fold）。
 * 面板半边是**同一个包的根 `index.js`**（宿主行，`inject:['webServer','shell']`）——
 * 两个挂载点共用 `lib/fold.mjs` 的投影口径，所以面板读数与 `eng_state` 永远同口径。
 *
 * **不写任何自定义会话事件**（AGENTS.md 毒药条）；文件读写全走 `ctx.shell` 接缝。
 */

export const name = 'fly-engagement-tools'
export const inject = ['tools', 'shell']

function argumentError(message) {
  const error = new Error(message)
  error.name = 'ArgumentError'
  return error
}

function shq(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`
}

/** 与五个安全包同一形状：`resolve()` + `execute()`，handle 上 `result` 是方法。 */
async function runCmd(shell, argv, exec, opts = {}) {
  const result = await (await shell.execute(shell.resolve({
    command: argv.map(shq).join(' '),
    ...opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {},
    signal: exec.signal,
  }))).result()
  if (result.aborted) {
    const error = new Error('tool call aborted')
    error.name = 'AbortError'
    throw error
  }
  if (result.sandbox?.denied) {
    const error = new Error(`[sandbox: file access denied under ${result.sandbox.mode} mode]`)
    error.name = 'SandboxError'
    throw error
  }
  return { stdout: result.stdout.text, stderr: result.stderr.text, exitCode: result.exitCode }
}

async function appendText(shell, file, text, exec) {
  const encoded = Buffer.from(text, 'utf8').toString('base64')
  return await runCmd(shell, ['sh', '-c', 'printf %s ' + shq(encoded) + ' | base64 -d >> ' + shq(file)], exec)
}

async function readText(shell, file, exec) {
  const run = await runCmd(shell, ['sh', '-c', 'cat ' + shq(file) + ' 2>/dev/null || true'], exec)
  return run.stdout
}

function normalizeRecord(args) {
  const goal = args.goal === undefined ? null : args.goal
  if (goal !== null) {
    if (typeof goal !== 'object') throw argumentError('goal 必须是一个对象')
    if (typeof goal.target !== 'string' || goal.target.trim() === '') throw argumentError('goal.target 必填（目标）')
    if (typeof goal.objective !== 'string' || goal.objective.trim() === '') throw argumentError('goal.objective 必填（目标/完成标准）')
  }
  const facts = Array.isArray(args.facts) ? args.facts : []
  const findings = Array.isArray(args.findings) ? args.findings : []
  const assets = Array.isArray(args.assets) ? args.assets : []
  const edges = Array.isArray(args.edges) ? args.edges : []
  for (const [index, fact] of facts.entries()) {
    if (typeof fact?.detail !== 'string' || fact.detail.trim() === '') throw argumentError('facts[' + index + '].detail 必填（确认到的证据）')
    if (fact.kind !== undefined && !FACT_KINDS.includes(fact.kind)) throw argumentError('facts[' + index + '].kind 只能是 ' + FACT_KINDS.join('/'))
  }
  for (const [index, finding] of findings.entries()) {
    if (typeof finding?.title !== 'string' || finding.title.trim() === '') throw argumentError('findings[' + index + '].title 必填')
    if (finding.severity !== undefined && !SEVERITIES.includes(finding.severity)) throw argumentError('findings[' + index + '].severity 只能是 ' + SEVERITIES.join('/'))
    if (!Array.isArray(finding.reproducibleSteps) || finding.reproducibleSteps.length === 0) {
      throw argumentError('findings[' + index + '].reproducibleSteps 必填且至少 1 条（没有复现步骤的漏洞不算记录）')
    }
    if (finding.reproducibleSteps.some(step => typeof step !== 'string' || step.trim() === '')) {
      throw argumentError('findings[' + index + '].reproducibleSteps 里每条都必须是非空字符串')
    }
  }
  for (const [index, asset] of assets.entries()) {
    if (!ASSET_TYPES.includes(asset?.type)) throw argumentError('assets[' + index + '].type 只能是 ' + ASSET_TYPES.join('/'))
    if (typeof asset.value !== 'string' || asset.value.trim() === '') throw argumentError('assets[' + index + '].value 必填')
  }
  for (const [index, edge] of edges.entries()) {
    if (!EDGE_KINDS.includes(edge?.kind)) throw argumentError('edges[' + index + '].kind 只能是 ' + EDGE_KINDS.join('/'))
    if (typeof edge.from !== 'string' || edge.from.trim() === '') throw argumentError('edges[' + index + '].from 必填')
    if (typeof edge.to !== 'string' || edge.to.trim() === '') throw argumentError('edges[' + index + '].to 必填')
  }
  return { goal, facts, findings, assets, edges }
}

const workspaceParam = { type: 'string', required: true, description: 'Absolute workspace path; the ledger lives in <workspace>/.fly-engagement/events.jsonl' }

export function apply(ctx) {
  const shell = ctx.shell

  ctx.tools.register(defineTool({
    name: 'eng_record',
    description: 'Record engagement evidence into the workspace ledger: goal (once), facts, findings (reproducible steps required), assets and edges. Returns deterministic ids for later reference.',
    parameters: {
      workspace: workspaceParam,
      goal: { type: 'object', additionalProperties: true, description: 'Once per engagement: { target, objective, authorization? }' },
      facts: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Facts: { kind?, target?, detail (required), confidence?, source? }' },
      findings: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Findings: { title, severity?, description?, reproducibleSteps (required), affectedAssetId? }' },
      assets: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Assets: { type, value, parentId?, meta? }' },
      edges: { type: 'array', items: { type: 'object', additionalProperties: true }, description: 'Edges: { kind: parent|proves|derived_from, from, to }' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (typeof args.workspace !== 'string' || args.workspace.trim() === '') throw argumentError('eng_record 需要 workspace（绝对路径）')
      const normalized = normalizeRecord(args)
      if (normalized.goal === null && normalized.facts.length === 0 && normalized.findings.length === 0 && normalized.assets.length === 0 && normalized.edges.length === 0) {
        throw argumentError('eng_record 一次要写至少一样东西（goal / facts / findings / assets / edges 全空）')
      }
      const file = ledgerPath(args.workspace)
      const dir = file.slice(0, file.lastIndexOf('/'))
      await runCmd(shell, ['sh', '-c', 'mkdir -p ' + shq(dir)], exec)
      const existing = foldEvents((await readText(shell, file, exec)).split('\n'))
      if (normalized.goal !== null && existing.goal !== null) {
        throw argumentError('这个 engagement 已经有 goal 了（target=' + existing.goal.target + '）—— 一个 engagement 只有一个 goal；要重新开始请换一个工作区')
      }
      const ids = new Set([...existing.facts.map(row => row.id), ...existing.findings.map(row => row.id), ...existing.assets.map(row => row.id)])
      const created = { facts: [], findings: [], assets: [], edges: [] }
      for (const asset of normalized.assets) {
        if (asset.parentId !== undefined && asset.parentId !== '' && !ids.has(asset.parentId)) {
          throw argumentError('assets.parentId=' + asset.parentId + ' 不存在（只能引用已记录的资产；同一次调用里请先写父资产）')
        }
        const row = { id: nextId('asset', [...existing.assets, ...created.assets]), ...asset }
        created.assets.push(row)
        ids.add(row.id)
      }
      for (const fact of normalized.facts) {
        const row = { id: nextId('fact', [...existing.facts, ...created.facts]), ...fact }
        created.facts.push(row)
        ids.add(row.id)
      }
      for (const finding of normalized.findings) {
        if (finding.affectedAssetId !== undefined && finding.affectedAssetId !== '' && !ids.has(finding.affectedAssetId)) {
          throw argumentError('findings.affectedAssetId=' + finding.affectedAssetId + ' 不存在（只能引用已记录的资产）')
        }
        const row = { id: nextId('finding', [...existing.findings, ...created.findings]), ...finding }
        created.findings.push(row)
        ids.add(row.id)
      }
      for (const edge of normalized.edges) {
        if (!ids.has(edge.from) || !ids.has(edge.to)) {
          throw argumentError('edges 的端点必须已记录（' + edge.from + ' → ' + edge.to + '）；未知 id 一律拒绝，不静默丢弃')
        }
        created.edges.push({ ...edge })
      }
      const events = []
      if (normalized.goal !== null) events.push({ op: 'goal', at: new Date().toISOString(), goal: normalized.goal })
      events.push({ op: 'record', at: new Date().toISOString(), facts: created.facts, findings: created.findings, assets: created.assets, edges: created.edges })
      await appendText(shell, file, events.map(event => JSON.stringify(event)).join('\n') + '\n', exec)
      return JSON.stringify({
        tool: 'eng_record',
        target: file,
        operation: 'append to the workspace ledger (goal/facts/findings/assets/edges)',
        observed: {
          created: { facts: created.facts.length, findings: created.findings.length, assets: created.assets.length, edges: created.edges.length },
          ids: { facts: created.facts.map(row => row.id), findings: created.findings.map(row => row.id), assets: created.assets.map(row => row.id) },
          goal: normalized.goal === null ? null : normalized.goal.target,
        },
        confidence: 'observed',
        limitations: [
          '记录是 append-only 的：写错要改请换工作区重来（v1 不做改写/删除）',
          'id 是确定性 <kind>-<n>（按会话内的记录次序），跨调用可引用；同一次调用内不能互相引用（先父后子）',
          'ledger 在 <workspace>/.fly-engagement/events.jsonl —— 工作区换一个就是另一个 engagement',
        ],
      }, null, 2)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'eng_state',
    description: 'Read the engagement projection: goal, nodes, edges, counts, and the window bookkeeping (dropped/refused/truncated).',
    parameters: {
      workspace: workspaceParam,
      window: { type: 'number', description: 'Node window per table (default 200)' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (typeof args.workspace !== 'string' || args.workspace.trim() === '') throw argumentError('eng_state 需要 workspace（绝对路径）')
      const windowSize = Math.min(2000, Math.max(1, Math.round(Number(args.window ?? 200) || 200)))
      const file = ledgerPath(args.workspace)
      const view = windowView(foldEvents((await readText(shell, file, exec)).split('\n')), windowSize)
      return JSON.stringify({
        tool: 'eng_state',
        target: file,
        operation: 'fold the workspace ledger into the engagement projection (window=' + windowSize + ')',
        observed: view,
        confidence: 'observed',
        limitations: [
          '投影是**窗口视图**：每张表只留最新 ' + windowSize + ' 条；dropped=' + view.dropped + '（被逐出）refused=' + view.refused + '（引用不存在的 id 被拒，累计）',
          view.truncated ? '⚠️ truncated=true：被逐出的记录不在这个视图里 —— 完整记录以 eng_report（读全量）为准' : '这次没有截断（每张表都在窗口内）',
          'ledger 不存在 ⇒ 空 projection（还没开始记录，不是错误）',
        ],
      }, null, 2)
    },
  }))

  ctx.tools.register(defineTool({
    name: 'eng_report',
    description: 'Render the engagement report as Markdown (goal + authorization, assets, facts with source tools, findings with reproducible steps, counts).',
    parameters: { workspace: workspaceParam },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
    async execute(args, exec) {
      if (typeof args.workspace !== 'string' || args.workspace.trim() === '') throw argumentError('eng_report 需要 workspace（绝对路径）')
      const file = ledgerPath(args.workspace)
      const state = foldEvents((await readText(shell, file, exec)).split('\n'))
      return JSON.stringify({
        tool: 'eng_report',
        target: file,
        operation: 'render the full engagement ledger as Markdown (no window)',
        observed: { markdown: renderReport(args.workspace, state), counts: { facts: state.facts.length, findings: state.findings.length, assets: state.assets.length, edges: state.edges.length }, refused: state.refused },
        confidence: 'observed',
        limitations: [
          '这份报告读的是**全量** ledger（不经窗口）—— 面板上的图是窗口视图，两者条数可能不同',
          'findings 的复现步骤原样列出（不重新编号内容、不排序）',
          'ledger 写在 <workspace>/.fly-engagement/events.jsonl；报告可以复制走，记录仍在工作区里',
        ],
      }, null, 2)
    },
  }))
}
