import { foldEvents, ledgerPath, renderReport, scopeView } from './lib/fold.mjs'

/**
 * fly-engagement —— **宿主平面的面板行**（根文件 = 裸包名，客户端半边才登记得上）。
 *
 * 形状照 `dsh-plugin-fly-smart`（一个包、两种挂载）：
 *   · 根 `index.js`（本文件）= 宿主行：`inject: ['webServer', 'shell']`，做
 *     `GET /fly/engagement/state|report` 与 `POST /fly/engagement/adopt`；
 *   · `tools/index.js` = agent 平面的 `eng_*`，由 preset 按会话挂；
 *   · 两半共用 `lib/fold.mjs` 的投影口径 ⇒ 面板读数与 `eng_state` 永远同口径。
 *
 * 数据来源：`<workspace>/.fly-engagement/events.jsonl`（append-only，投影=fold）。
 * 一个工作区一条账本，**每行带 session 归属**；默认只看本会话，`scope=workspace` 看全部。
 * 读文件走沙箱化的 `ctx.shell` 接缝（本包不 import `node:fs`）。
 */

export const name = 'fly-engagement-panel'
export const inject = ['webServer', 'shell']

const BASE = '/fly/engagement'

function shq(value) {
  return `'${String(value).replace(/'/g, "'\\''")}'`
}

async function readText(shell, file) {
  const handle = await shell.execute(shell.resolve({ command: 'cat ' + shq(file) + ' 2>/dev/null || true' }))
  const result = await handle.result()
  if (result.sandbox?.denied) {
    const error = new Error(`[sandbox: file access denied under ${result.sandbox.mode} mode]`)
    error.name = 'SandboxError'
    throw error
  }
  return result.stdout.text
}

async function appendText(shell, file, text) {
  const encoded = Buffer.from(text, 'utf8').toString('base64')
  const handle = await shell.execute(shell.resolve({ command: 'printf %s ' + shq(encoded) + ' | base64 -d >> ' + shq(file) }))
  const result = await handle.result()
  if (result.sandbox?.denied) {
    const error = new Error(`[sandbox: file access denied under ${result.sandbox.mode} mode]`)
    error.name = 'SandboxError'
    throw error
  }
  return result
}

function json(res, status, payload) {
  const body = JSON.stringify(payload, null, 2)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

/** 每条路由都自述（面板的"这个面板能问什么"表，与 netops 同一条纪律）。 */
export const endpoints = [
  { path: `${BASE}/state`, summary: 'engagement 投影（与 eng_state 同口径）：?workspace=&session=&scope=session|workspace&window=' },
  { path: `${BASE}/report`, summary: 'Markdown 报告（与 eng_report 同一份渲染）：?workspace=&session=&scope=' },
  { path: `${BASE}/adopt`, method: 'POST', summary: '认领未归属（v1）记录到当前会话：{ workspace, session, all? , ids?, goal? }' },
]

function badWorkspace(workspace) {
  if (typeof workspace !== 'string' || workspace.trim() === '') return 'missing ?workspace=<absolute path>'
  if (!workspace.startsWith('/')) return 'workspace 必须是绝对路径（收到 ' + workspace + '）'
  return null
}

/**
 * 处理一条 GET。`?workspace=<绝对路径>` 必填；`session` 缺省 = 未归属（v1 遗留）。
 * 返回 `{ status, payload }`，由 transport 层写回 —— 纯函数，好测。
 */
export async function answer(shell, url) {
  const path = String(url ?? '/')
  if (!path.startsWith(BASE)) return { status: 404, payload: { error: 'not found', endpoints } }
  const query = new URLSearchParams(path.slice(path.indexOf('?') + 1))
  const workspace = query.get('workspace')
  const invalid = badWorkspace(workspace)
  if (invalid !== null) return { status: 400, payload: { error: invalid, endpoints } }
  const session = (query.get('session') ?? '').trim() === '' ? null : query.get('session')
  const scope = query.get('scope') === 'workspace' ? 'workspace' : 'session'
  const windowSize = Math.min(2000, Math.max(1, Math.round(Number(query.get('window') ?? 200) || 200)))
  const file = ledgerPath(workspace)
  const state = foldEvents((await readText(shell, file)).split('\n'))
  const view = scopeView(state, { session, scope }, windowSize)
  if (path.startsWith(BASE + '/report')) {
    return { status: 200, payload: { workspace, ledger: file, session, scope, markdown: renderReport(workspace, view) } }
  }
  if (path.startsWith(BASE + '/state')) {
    return {
      status: 200,
      payload: { workspace, ledger: file, window: windowSize, session, scope, projection: view, endpoints },
    }
  }
  return { status: 404, payload: { error: 'not found', endpoints } }
}

/**
 * `POST /fly/engagement/adopt` —— 面板上的「认领未归属记录」按钮走这里。
 * 只改未归属（session=null）的行；已归属其他会话的一律跳过。
 */
export async function adopt(shell, body) {
  const workspace = body?.workspace
  const invalid = badWorkspace(workspace)
  if (invalid !== null) return { status: 400, payload: { error: invalid, endpoints } }
  const session = typeof body?.session === 'string' ? body.session.trim() : ''
  if (session === '') return { status: 400, payload: { error: 'adopt 需要 session（当前会话身份）', endpoints } }
  const file = ledgerPath(workspace)
  const state = foldEvents((await readText(shell, file)).split('\n'))
  const unowned = [...state.facts, ...state.findings, ...state.assets].filter(row => (row.session ?? null) === null)
  const ids = body?.all === true ? unowned.map(row => row.id) : (Array.isArray(body?.ids) ? body.ids : [])
  const goal = body?.goal === true || body?.all === true
  if (ids.length === 0 && goal === false) {
    return { status: 400, payload: { error: '没有可认领的记录（未归属为空，且未请求 goal）', endpoints } }
  }
  const event = { op: 'adopt', at: new Date().toISOString(), session, ids, goal }
  await appendText(shell, file, JSON.stringify(event) + '\n')
  const after = foldEvents((await readText(shell, file)).split('\n'))
  const view = scopeView(after, { session, scope: 'session' }, 2000)
  const count = rows => rows.filter(row => (row.session ?? null) === null).length
  return {
    status: 200,
    payload: {
      workspace,
      session,
      adopted: {
        facts: count(state.facts) - count(after.facts),
        findings: count(state.findings) - count(after.findings),
        assets: count(state.assets) - count(after.assets),
        edges: count(state.edges) - count(after.edges),
        goal: state.goals.filter(row => row.session === null).length - after.goals.filter(row => row.session === null).length,
      },
      legacy: view.legacy,
      skipped: after.skipped,
    },
  }
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const text = Buffer.concat(chunks).toString('utf8')
  return text === '' ? {} : JSON.parse(text)
}

export function apply(ctx) {
  const shell = ctx.shell
  ctx.effect(
    () => {
      // `webServer.register` 对重复的 (kind, path) 是**抛错**语义（组合层契约）。
      // profile 热重载时若上一代路由还没被 dispose，新实例会撞上它 —— 这里把失败
      // 写进宿主日志再抛，否则症状只是"面板一直 404"而没有任何线索。
      try {
        return ctx.webServer.register({
          kind: 'prefix',
          path: BASE,
          handler: async (req, res) => {
            try {
              const url = req.url ?? '/'
              if (req.method === 'POST' && String(url).startsWith(BASE + '/adopt')) {
                const { status, payload } = await adopt(shell, await readBody(req))
                json(res, status, payload)
                return
              }
              if (req.method !== 'GET') {
                json(res, 405, { error: 'method not allowed', endpoints })
                return
              }
              const { status, payload } = await answer(shell, url)
              json(res, status, payload)
            } catch (error) {
              json(res, 500, { error: String(error?.message ?? error), endpoints })
            }
          },
        })
      } catch (error) {
        ctx.logger?.error?.('fly-engagement: 注册 ' + BASE + '/* 失败（面板将 404）', error)
        throw error
      }
    },
    'fly-engagement: ' + BASE + '/*',
  )
}
