/**
 * 真接缝桩：`ShellExecutor` 只有 `resolve()` + `execute()`，且 `execute()` 返回的 handle 上
 * **`result` 是方法**（`result(): Promise<ShellRunResult>`），不是属性。
 *
 * 两个特征都是刻意的，因为这两条正是踩过的事故形状：
 *
 *  1. **不提供 `run`** —— 五个安全插件从初始提交起都写 `await shell.run(...)`（接缝上从来
 *     没有这个方法），15 个工具里 12 个一调用就 `TypeError`，而当时的门禁只看"preset 里有
 *     这一行"。桩不提供 `run`，这条形状一回归就当场红。
 *  2. **`result` 做成方法** —— 老桩发的是 promise **属性**，插件写 `.result` 于是 await 到
 *     函数本身、`stdout` 全是 undefined，而门禁当时是 `failed: 0 PASS`。桩越像"我以为的
 *     接缝"，门禁越绿得彻底。
 *
 * 命令真的执行（`/bin/sh -c`，与 `scripts/verify-security-tools.mjs` 同一条路），每条经过
 * 接缝的命令都记进 `audit` —— 它是唯一能证明"某条命令**没有**被构造出来"的尺子
 * （这个沙箱里 `ps` 整个跑不动，见 AGENTS.md 坑表）。
 *
 * 这个文件**随包走**：拆仓之后 `tests/` 里的断言仍旧拿到同一个形状的接缝。
 */

import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

/**
 * 造一个真接缝桩。
 *
 * @returns `{ shell, audit, requests }`：`audit` 是**真的执行了**的命令，`requests` 是每个
 *   `resolve()` 的入参（长跑进程的 `onExpiry: 'none'` 这类形状只能从这里看见）。
 */
export function createSeam() {
  const audit = []
  const requests = []
  const resolve = request => {
    requests.push(request)
    return {
      command: request.command,
      timeoutMs: request.timeoutMs ?? 120_000,
      stdoutMaxBytes: request.stdoutMaxBytes ?? 262_144,
      signal: request.signal,
      ...(request.onExpiry === undefined ? {} : { onExpiry: request.onExpiry }),
    }
  }
  const execute = spec => {
    audit.push(spec.command)
    const result = new Promise(settle => {
      const child = spawn('/bin/sh', ['-c', spec.command], { maxBuffer: 64 * 1024 * 1024 })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', chunk => { stdout += chunk })
      child.stderr.on('data', chunk => { stderr += chunk })
      child.on('close', code => settle({
        exitCode: code,
        signal: null,
        timedOut: false,
        aborted: false,
        timeoutMs: spec.timeoutMs,
        stdout: { text: stdout.slice(0, spec.stdoutMaxBytes) },
        stderr: { text: stderr },
      }))
    })
    return Promise.resolve({ result: () => result })
  }
  return { shell: { resolve, execute }, audit, requests }
}

/**
 * 把插件挂到真形状的 `ctx` 上。
 *
 * @param entryUrl - 插件的 `index.js` 的 file URL。
 * @param options - `extra` 合并进 ctx（本包之外的接缝，例如 blackbox 的 `skills`）。
 */
export async function mountPackage(entryUrl, { extra = {} } = {}) {
  const seam = createSeam()
  const tools = new Map()
  const guards = []
  const ctx = {
    shell: seam.shell,
    tools: { register: tool => tools.set(tool.name, tool) },
    on: (event, handler) => { if (event === 'tools/pre-execute') guards.push(handler) },
    ...extra,
  }
  const module = await import(entryUrl)
  module.apply(ctx)
  return { module, seam, tools, guards, ctx, audit: seam.audit, requests: seam.requests }
}

/** 工具调用用的 execution 上下文（工具只读 `signal`）。 */
export function execContext(extra = {}) {
  return { signal: new AbortController().signal, ...extra }
}

/**
 * 调一个工具，返回 `{ ok, text, error }`。
 *
 * `text` 与 `error` **两支都永远在**：门禁里到处写 `<x>Out.text…`，失败支缺 `text` 会让
 * 失败文案自己抛 `TypeError`，整段输出只剩一段栈（见 AGENTS.md 坑表）。
 */
export async function callTool(tools, name, args, exec = execContext()) {
  const tool = tools.get(name)
  if (tool === undefined) return { ok: false, text: '', error: `tool ${name} is not registered` }
  try {
    return { ok: true, text: String(await tool.execute(args, exec)), error: '' }
  } catch (error) {
    return { ok: false, text: '', error: `${error.name}: ${error.message}` }
  }
}

/**
 * `tools/pre-execute` 的忠实 waterfall：guard → next() → … → allow。
 *
 * 授权门是**工具之外**的一层，直接调 `tool.execute()` 会绕过它，所以测门必须自己跑这条链
 * （`verify-blackbox.mjs` 与 `verify-security-tools.mjs` 同一条形状）。
 */
export async function runGuards(guards, exec) {
  let index = -1
  const next = async () => {
    index += 1
    return index >= guards.length ? { kind: 'allow' } : await guards[index](exec, next)
  }
  return next()
}

/** 夹具一律造在**仓库外**（`mkdtempSync(tmpdir())`），绝不落进仓库。 */
export function scratchDir(prefix = 'fly-plugin-tests-') {
  return mkdtempSync(join(tmpdir(), prefix))
}

/** 往夹具目录里写一个文件，返回**绝对路径**（失败信息里要能直接复制）。 */
export function writeFixture(dir, name, content) {
  const path = join(dir, name)
  writeFileSync(path, content)
  return path
}

/** 去注释：注释里故意写着事故形状（`shell.run`、`child_process`），扫描读自己的解释就是假阳性机器。 */
export function stripComments(text) {
  return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/^\s*\/\/.*$/gmu, '')
}

/**
 * 插件**自己要解析的那份** peer 依赖（`@deepseek-ai/dsh-shell`）声明的接缝方法集合。
 *
 * 拿它当尺子有两个用处：① 版本漂移（引擎真加了/改了方法）在这里红，而不是在真会话里；
 * ② 断言"这个桩与真接缝同形" —— 桩自己的方法名必须与声明逐一对应，且**不含声明外的名字**。
 *
 * @param packageDir - 插件包目录（`tests/` 的上一级）。
 */
export function seamContract(packageDir) {
  const requireFromPackage = createRequire(pathToFileURL(join(packageDir, 'index.js')))
  const manifestPath = requireFromPackage.resolve('@deepseek-ai/dsh-shell/package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  const types = readFileSync(join(dirname(manifestPath), 'lib', 'types', 'index.d.ts'), 'utf8')
  return {
    version: manifest.version,
    methods: new Set([...types.matchAll(/abstract\s+([A-Za-z_$][\w$]*)\s*\(/gu)].map(match => match[1])),
  }
}
