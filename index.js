import { foldEvents, ledgerPath, renderReport, windowView } from './lib/fold.mjs'

/**
 * fly-engagement —— **宿主平面的面板行**（根文件 = 裸包名，客户端半边才登记得上）。
 *
 * 形状照 `dsh-plugin-fly-smart`（一个包、两种挂载）：
 *   · 根 `index.js`（本文件）= 宿主行：`inject: ['webServer', 'shell']`，只做
 *     `GET /fly/engagement/state|report`；**不注册工具**（bundle patch 里没有 `inject:['tools']` 的行）；
 *   · `tools/index.js` = agent 平面的三个 `eng_*`，由 preset 按会话挂；
 *   · 两半共用 `lib/fold.mjs` 的投影口径 ⇒ 面板读数与 `eng_state` 永远同口径。
 *
 * 数据来源：`<workspace>/.fly-engagement/events.jsonl`（append-only，投影=fold），
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

function json(res, status, payload) {
  const body = JSON.stringify(payload, null, 2)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

/** 每条路由都自述（面板的"这个面板能问什么"表，与 netops 同一条纪律）。 */
export const endpoints = [
  { path: `${BASE}/state`, summary: 'engagement 投影（与 eng_state 同口径）：goal/节点/边/counts/dropped/refused/truncated' },
  { path: `${BASE}/report`, summary: '全量 Markdown 报告（与 eng_report 同一份渲染）' },
]

/**
 * 处理一条请求。`?workspace=<绝对路径>` 必填（取不到会话 cwd 时由面板填 + 记忆）。
 * 返回 `{ status, payload }`，由 transport 层写回 —— 纯函数，好测。
 */
export async function answer(shell, url) {
  const path = String(url ?? '/')
  if (!path.startsWith(BASE)) return { status: 404, payload: { error: 'not found', endpoints } }
  const query = new URLSearchParams(path.slice(path.indexOf('?') + 1))
  const workspace = query.get('workspace')
  if (workspace === null || workspace.trim() === '') {
    return { status: 400, payload: { error: 'missing ?workspace=<absolute path>', endpoints } }
  }
  if (!workspace.startsWith('/')) {
    return { status: 400, payload: { error: 'workspace 必须是绝对路径（收到 ' + workspace + '）', endpoints } }
  }
  const windowSize = Math.min(2000, Math.max(1, Math.round(Number(query.get('window') ?? 200) || 200)))
  const file = ledgerPath(workspace)
  const state = foldEvents((await readText(shell, file)).split('\n'))
  if (path.startsWith(BASE + '/report')) {
    return { status: 200, payload: { workspace, ledger: file, markdown: renderReport(workspace, state) } }
  }
  if (path.startsWith(BASE + '/state')) {
    return {
      status: 200,
      payload: {
        workspace,
        ledger: file,
        window: windowSize,
        projection: windowView(state, windowSize),
        endpoints,
      },
    }
  }
  return { status: 404, payload: { error: 'not found', endpoints } }
}

export function apply(ctx) {
  const shell = ctx.shell
  ctx.effect(
    () => ctx.webServer.register({
      kind: 'prefix',
      path: BASE,
      handler: async (req, res) => {
        try {
          const { status, payload } = await answer(shell, req.url ?? '/')
          json(res, status, payload)
        } catch (error) {
          json(res, 500, { error: String(error?.message ?? error), endpoints })
        }
      },
    }),
    'fly-engagement: ' + BASE + '/*',
  )
}
