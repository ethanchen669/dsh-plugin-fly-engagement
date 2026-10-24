/**
 * 会话维度（v2）：同一个工作区里，多个会话各自一条证据链。
 *
 * 这组尺子量的是**场景**，不是实现细节：
 *   1. 同一 default-workspace，会话 A 分析程序甲、会话 B 分析程序乙 —— 互不可见；
 *   2. 同一 repo，两个会话分析不同模块 —— 同上；
 *   3. goal 每会话一个，不再"一个工作区一个"；
 *   4. v1 遗留记录（无 session）可以**认领**到当前会话，但不能抢别人的记录。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { callTool, execContext, mountPackage } from './seam.mjs'

const ENTRY = pathToFileURL(new URL('../tools/index.js', import.meta.url).pathname).href

const as = id => execContext({ agent: { id } })

async function withTools() {
  const { tools } = await mountPackage(ENTRY)
  return tools
}

function workspace() {
  return mkdtempSync(join(tmpdir(), 'fly-engagement-session-'))
}

const read = async (tools, name, args, exec) => {
  const out = await callTool(tools, name, args, exec)
  assert.ok(out.ok, `${name} 失败：${out.error}`)
  return JSON.parse(out.text).observed
}

test('同工作区两会话：默认只见本会话，scope=workspace 才合并', async () => {
  const tools = await withTools()
  const ws = workspace()
  const a = as('sess-A')
  const b = as('sess-B')
  await callTool(tools, 'eng_record', { workspace: ws, facts: [{ detail: 'program-A evidence' }] }, a)
  await callTool(tools, 'eng_record', { workspace: ws, facts: [{ detail: 'program-B evidence' }] }, b)

  const viewA = await read(tools, 'eng_state', { workspace: ws }, a)
  assert.equal(viewA.counts.facts, 1, '会话 A 不该看见 B 的记录')
  assert.equal(viewA.facts[0].session, 'sess-A', '投影里每条都必须带出处会话')
  assert.equal(viewA.scope, 'session')
  assert.equal(viewA.workspaceCounts.facts, 2, '工作区合计必须同时给出')

  const all = await read(tools, 'eng_state', { workspace: ws, scope: 'workspace' }, a)
  assert.equal(all.counts.facts, 2, 'scope=workspace 时两个会话的记录都要在')
  assert.equal(all.scope, 'workspace')
})

test('goal 按会话独立：A 写过 goal 不影响 B，同一会话第二次仍被拒', async () => {
  const tools = await withTools()
  const ws = workspace()
  const a = as('sess-A')
  const b = as('sess-B')
  const first = await callTool(tools, 'eng_record', { workspace: ws, goal: { target: 'A', objective: 'o' } }, a)
  assert.ok(first.ok, first.error)
  const second = await callTool(tools, 'eng_record', { workspace: ws, goal: { target: 'B', objective: 'o' } }, b)
  assert.ok(second.ok, '另一个会话写 goal 不该被拒：' + second.error)
  const again = await callTool(tools, 'eng_record', { workspace: ws, goal: { target: 'A2', objective: 'o' } }, a)
  assert.ok(!again.ok, '同一会话第二个 goal 必须被拒')
  assert.match(again.error, /已经有 goal/u, again.error)

  const viewB = await read(tools, 'eng_state', { workspace: ws }, b)
  assert.equal(viewB.goal.target, 'B', '会话 B 必须看到自己的 goal')
})

test('v1 遗留记录（无 session）默认不可见，但可整体认领到当前会话', async () => {
  const tools = await withTools()
  const ws = workspace()
  const a = as('sess-A')
  // 无 agent 的调用 = v1 形状（session=null）
  await callTool(tools, 'eng_record', { workspace: ws, facts: [{ detail: 'legacy evidence' }], goal: { target: 'legacy', objective: 'o' } })

  const before = await read(tools, 'eng_state', { workspace: ws }, a)
  assert.equal(before.counts.facts, 0, '会话视图里不该出现未归属记录')
  assert.equal(before.legacy.facts, 1, '未归属计数必须单独给出')
  assert.equal(before.legacy.goal, 1, '未归属 goal 也要计数')

  const adopted = await read(tools, 'eng_adopt', { workspace: ws, all: true }, a)
  assert.equal(adopted.adopted.facts, 1, '认领必须真的改归属：' + JSON.stringify(adopted))
  assert.equal(adopted.adopted.goal, 1, 'goal 也要一起认领')

  const after = await read(tools, 'eng_state', { workspace: ws }, a)
  assert.equal(after.counts.facts, 1, '认领后本会话必须看得见')
  assert.equal(after.legacy.facts, 0, '认领后未归属计数必须归零')
  assert.equal(after.goal.target, 'legacy', '认领后 goal 归本会话')
})

test('eng_adopt 不抢别人的记录：已归属其他会话的一律不动', async () => {
  const tools = await withTools()
  const ws = workspace()
  const a = as('sess-A')
  const b = as('sess-B')
  await callTool(tools, 'eng_record', { workspace: ws, facts: [{ detail: 'B only' }] }, b)

  const adopted = await read(tools, 'eng_adopt', { workspace: ws, all: true }, a)
  assert.equal(adopted.adopted.facts, 0, '别人的记录不该被认领')
  assert.ok(adopted.skipped >= 1, '被跳过的条数必须报出来')

  const viewB = await read(tools, 'eng_state', { workspace: ws }, b)
  assert.equal(viewB.counts.facts, 1, 'B 的记录必须仍在 B 名下')
})

test('显式 session 参数优先于 exec.agent（便于补录/迁移）', async () => {
  const tools = await withTools()
  const ws = workspace()
  await callTool(tools, 'eng_record', { workspace: ws, session: 'imported', facts: [{ detail: 'x' }] }, as('sess-A'))
  const view = await read(tools, 'eng_state', { workspace: ws, session: 'imported' }, as('sess-B'))
  assert.equal(view.counts.facts, 1)
})

test('边跟随端点：adopt 只认领节点后，连线仍在会话视图里可见', async () => {
  const tools = await withTools()
  const ws = workspace()
  const a = as('sess-A')
  // v1 形状：节点与边都无 session（边在单独一条 record 里，照实账本形状）
  await callTool(tools, 'eng_record', { workspace: ws, facts: [{ detail: 'f' }], findings: [{ title: 'x', reproducibleSteps: ['s'] }] })
  await callTool(tools, 'eng_record', { workspace: ws, edges: [{ kind: 'proves', from: 'fact-1', to: 'finding-1' }] })

  const adopted = await read(tools, 'eng_adopt', { workspace: ws, all: true }, a)
  assert.equal(adopted.adopted.facts, 1, '节点要认领')
  assert.equal(adopted.adopted.edges, 1, '两端都归本会话的边也要一起认领')

  const view = await read(tools, 'eng_state', { workspace: ws }, a)
  assert.equal(view.counts.edges, 1, '会话视图里边必须可见（回归：边不跟随端点就只剩节点、没有连线）')
  assert.equal(view.edges[0].from, 'fact-1')
  assert.equal(view.edges[0].to, 'finding-1')
})
