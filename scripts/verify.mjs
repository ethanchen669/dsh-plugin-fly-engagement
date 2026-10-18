/**
 * 本仓自己的门禁（形状照 `dsh-plugin-fly-smart` 的 `verify-smart.mjs`：不装依赖、不构建，
 * 只跑包内测试 + 几条静态钉子；CI 与 release 都跑它）。
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
let failed = 0
const check = (label, ok, detail = '') => {
  console.log((ok ? '  ✓ ' : '  ✗ ') + label + (detail === '' ? '' : '  — ' + detail))
  if (!ok) failed += 1
}

// 1. 包内测试（真接缝桩，8 条）
const tests = spawnSync(process.execPath, ['--test', 'tests/behavior.spec.mjs'], { cwd: ROOT, encoding: 'utf8' })
const passLine = (tests.stdout ?? '').split('\n').find(line => line.startsWith('ℹ pass')) ?? '(no summary)'
check('包内测试全绿（' + passLine.trim() + '）', tests.status === 0, tests.status === 0 ? '' : (tests.stderr ?? '').slice(-400))

// 2. 毒药条：**不许写自定义会话事件**（本包一个 `Session.append` / `session.append` 都不该有）
const sources = ['index.js', 'tools/index.js', 'lib/fold.mjs'].map(file => readFileSync(join(ROOT, file), 'utf8'))
check('不写自定义会话事件（无 Session.append）', !sources.some(text => /Session\.append|session\.append/u.test(text)))

// 3. 文件读写走 shell 接缝：三份源码都不许 import node:fs
check('不 import node:fs（读文件走 ctx.shell 接缝）', !sources.some(text => /from ['"]node:fs['"]/u.test(text)))

// 4. 两半共用一份投影：tools 与根都从 lib/fold.mjs 取
check('tools 与宿主行共用 lib/fold.mjs 的投影口径',
  /from '\.\.\/lib\/fold\.mjs'/u.test(sources[1]) && /from '\.\/lib\/fold\.mjs'/u.test(sources[0]))

// 5. 面板注册面：裸包名（带 `/` 的行名客户端半边登记不上）
const patchRaw = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
// 去注释再判：patch 的**注释里**就写着「不许有 inject: ['tools'] 的行」，直接 grep 会把自己判红
const patch = patchRaw.split('\n').filter(line => !line.trimStart().startsWith('#')).join('\n')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
check('bundle patch 用裸包名挂面板行', patch.includes("name: @dsh-fly/dsh-plugin-fly-engagement"))
check('bundle patch 里没有 inject: [\'tools\'] 的行', !/inject:\s*\[[^\]]*tools/u.test(patch))
check('dsh.client 声明了 sidebar-right 注入', (pkg.dsh?.client?.inject ?? []).includes('@deepseek-ai/dsh-client-ui-sidebar-right'))
check('声明了 dsh.bundle.patch', pkg.dsh?.bundle?.patch === './cordis.patch.yml')

console.log('')
console.log(failed === 0 ? 'PASS (' + (5 + 3) + ' checks)' : 'FAIL — ' + failed + ' 条不过')
process.exit(failed === 0 ? 0 : 1)
