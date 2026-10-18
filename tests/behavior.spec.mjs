/**
 * fly-engagement 的尺子（docs/security-mode-review-and-plan.md §11.6）。
 *
 * 每条都断**真值**：确定性 id、引用大声拒、复现步骤必填、`counts` 与逐项相加一致、
 * 窗口逐出的 `dropped`、fold 出来的 `refused`、报告与记录自洽 —— 不断"返回了个对象"。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { callTool, mountPackage } from './seam.mjs'

const ENTRY = pathToFileURL(new URL('../tools/index.js', import.meta.url).pathname).href

function workspace() {
  return mkdtempSync(join(tmpdir(), 'fly-engagement-test-'))
}

async function withTools() {
  const { tools } = await mountPackage(ENTRY)
  return tools
}

test('eng_record：确定性 id <kind>-<n>，信封给回可引用的 id', async () => {
  const tools = await withTools()
  const ws = workspace()
  const first = await callTool(tools, 'eng_record', {
    workspace: ws,
    goal: { target: '10.0.0.0/24', objective: 'exposed admin panels' },
    facts: [{ detail: 'nginx/1.18.0' }],
    assets: [{ type: 'host', value: '10.0.0.5' }],
  })
  assert.ok(first.ok, `第一次 record 抛了：${first.error}`)
  const ids = JSON.parse(first.text).observed.ids
  assert.deepEqual(ids.facts, ['fact-1'], '第一条 fact 必须是 fact-1')
  assert.deepEqual(ids.assets, ['asset-1'], '第一条 asset 必须是 asset-1')

  const second = await callTool(tools, 'eng_record', { workspace: ws, facts: [{ detail: 'port 8080 open' }, { detail: 'port 22 open' }] })
  assert.ok(second.ok, `第二次 record 抛了：${second.error}`)
  assert.deepEqual(JSON.parse(second.text).observed.ids.facts, ['fact-2', 'fact-3'], 'id 必须按序递增（确定性）')
})

test('eng_record：未知引用**大声拒**（不是静默丢弃）', async () => {
  const tools = await withTools()
  const ws = workspace()
  await callTool(tools, 'eng_record', { workspace: ws, goal: { target: 't', objective: 'o' }, assets: [{ type: 'host', value: 'h' }] })
  const badParent = await callTool(tools, 'eng_record', { workspace: ws, assets: [{ type: 'service', value: 's', parentId: 'asset-999' }] })
  assert.ok(!badParent.ok, '未知 parentId 居然成功了')
  assert.match(badParent.error, /asset-999.*不存在/u, '报错必须点名那个不存在的 id：' + badParent.error)

  const badEdge = await callTool(tools, 'eng_record', { workspace: ws, edges: [{ kind: 'proves', from: 'fact-999', to: 'asset-1' }] })
  assert.ok(!badEdge.ok, '未知边的端点居然成功了')
  assert.match(badEdge.error, /端点必须已记录/u, '边的报错口径不对：' + badEdge.error)
})

test('eng_record：finding 的 reproducibleSteps 必填且 ≥1 条', async () => {
  const tools = await withTools()
  const ws = workspace()
  const missing = await callTool(tools, 'eng_record', { workspace: ws, findings: [{ title: 'x' }] })
  assert.ok(!missing.ok, '缺复现步骤居然成功了')
  assert.match(missing.error, /reproducibleSteps/u, '报错没说缺什么：' + missing.error)
  const empty = await callTool(tools, 'eng_record', { workspace: ws, findings: [{ title: 'x', reproducibleSteps: [] }] })
  assert.ok(!empty.ok, '空步骤数组居然成功了')
  const blank = await callTool(tools, 'eng_record', { workspace: ws, findings: [{ title: 'x', reproducibleSteps: ['  '] }] })
  assert.ok(!blank.ok, '空白步骤居然成功了')
})

test('eng_record：goal 只能设置一次（再带 ⇒ 大声拒）', async () => {
  const tools = await withTools()
  const ws = workspace()
  await callTool(tools, 'eng_record', { workspace: ws, goal: { target: 'a', objective: 'b' } })
  const again = await callTool(tools, 'eng_record', { workspace: ws, goal: { target: 'c', objective: 'd' } })
  assert.ok(!again.ok, '第二个 goal 居然成功了')
  assert.match(again.error, /已经有 goal/u, '报错没讲清：' + again.error)
})

test('eng_state：counts 与逐项相加一致；窗口逐出时 dropped>0 且 truncated', async () => {
  const tools = await withTools()
  const ws = workspace()
  await callTool(tools, 'eng_record', { workspace: ws, goal: { target: 't', objective: 'o' } })
  for (let index = 0; index < 5; index += 1) {
    await callTool(tools, 'eng_record', { workspace: ws, facts: [{ detail: 'fact ' + index }] })
  }
  const wide = JSON.parse((await callTool(tools, 'eng_state', { workspace: ws })).text).observed
  assert.equal(wide.counts.facts, 5, 'counts.facts 必须等于实际条数')
  assert.equal(wide.facts.length, 5, '窗口够大时应全给')
  assert.equal(wide.truncated, false)
  assert.equal(wide.dropped, 0)

  const narrow = JSON.parse((await callTool(tools, 'eng_state', { workspace: ws, window: 2 })).text).observed
  assert.equal(narrow.facts.length, 2, 'window=2 只该留 2 条')
  assert.equal(narrow.dropped, 3, '逐出条数必须计入 dropped（5-2=3）')
  assert.equal(narrow.truncated, true, '有逐出就必须 truncated=true（省略不藏起来）')
  assert.equal(narrow.counts.facts, 5, 'counts 报全量、窗口只影响 rows —— 两个读数都要在')
})

test('eng_state：fold 会把"引用不存在的 id"记成 refused（手搓 ledger 证明）', async () => {
  const tools = await withTools()
  const ws = workspace()
  const dir = join(ws, '.fly-engagement')
  mkdirSync(dir, { recursive: true })
  const events = [
    { op: 'goal', goal: { target: 't', objective: 'o' } },
    { op: 'record', facts: [{ id: 'fact-1', detail: 'ok' }], assets: [], findings: [], edges: [] },
    { op: 'record', facts: [], assets: [], findings: [], edges: [{ kind: 'proves', from: 'fact-1', to: 'finding-404' }] },
    { op: 'record', facts: [], assets: [{ id: 'asset-1', type: 'host', value: 'h', parentId: 'asset-404' }], findings: [], edges: [] },
  ]
  writeFileSync(join(dir, 'events.jsonl'), events.map(event => JSON.stringify(event)).join('\n') + '\n', 'utf8')
  const state = JSON.parse((await callTool(tools, 'eng_state', { workspace: ws })).text).observed
  assert.equal(state.refused, 2, '两条坏引用都必须计入 refused（不是静默丢弃）')
  assert.equal(state.facts.length, 1, '好的那条 fact 仍要在')
  assert.equal(state.assets.length, 0, '被拒的 asset 不该出现在投影里')
})

test('eng_report：复现步骤条数 === finding 的步骤数；含授权与来源工具；读全量', async () => {
  const tools = await withTools()
  const ws = workspace()
  await callTool(tools, 'eng_record', {
    workspace: ws,
    goal: { target: '10.0.0.5', objective: 'test admin panel', authorization: 'permission #A-17' },
    assets: [{ type: 'host', value: '10.0.0.5' }],
    facts: [{ kind: 'http', target: 'http://10.0.0.5/admin', detail: 'returns 200', source: { tool: 'recon_http_fingerprint', operation: 'fetch headers' } }],
    findings: [{ title: 'unauth admin', severity: 'high', reproducibleSteps: ['curl -i http://10.0.0.5/admin', 'observe 200'] }],
  })
  const report = JSON.parse((await callTool(tools, 'eng_report', { workspace: ws })).text).observed
  const markdown = report.markdown
  assert.match(markdown, /permission #A-17/u, '报告必须带授权说明（审计事实）')
  assert.match(markdown, /recon_http_fingerprint/u, '事实必须记来源工具')
  const steps = (markdown.match(/^\d+\. /gmu) ?? []).length
  assert.equal(steps, 2, '复现步骤条数必须等于 finding 里的步骤数（实得 ' + steps + '）')
  assert.match(markdown, /unauth admin/u, '报告里要有漏洞标题')
  assert.match(markdown, /high/u, '报告里要有严重度')
})

test('eng_state：ledger 不存在 ⇒ 空投影（不是错误）', async () => {
  const tools = await withTools()
  const ws = workspace()
  const out = await callTool(tools, 'eng_state', { workspace: ws })
  assert.ok(out.ok, `空工作区不该报错：${out.error}`)
  const observed = JSON.parse(out.text).observed
  assert.equal(observed.goal, null)
  assert.deepEqual(observed.counts, { facts: 0, findings: 0, assets: 0, edges: 0 })
  assert.equal(existsSync(join(ws, '.fly-engagement', 'events.jsonl')), false, '只读不该创建 ledger')
})
