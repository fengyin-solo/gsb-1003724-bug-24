// 纯逻辑验证：模拟 localStorage，走真实模块文件，验证复核结论持久化、
// 旧数据规范化、重复复核幂等、并发只生效一次、整编待办/列表/导出同源。
const fs = require('fs')
const path = require('path')
const ts = require(path.join(__dirname, '..', 'frontend', 'node_modules', 'typescript'))

const FRONT = path.join(__dirname, '..', 'frontend', 'src')
const outDir = path.join(__dirname, '.logic-build')

// 简易转译：把 @/ 别名指到 src，输出 CJS 供 node require。
function compileDir(srcDir) {
  const files = []
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const full = path.join(srcDir, entry.name)
    if (entry.isDirectory()) files.push(...compileDir(full))
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) files.push(full)
  }
  return files
}

const files = compileDir(FRONT)
for (const file of files) {
  const code = fs.readFileSync(file, 'utf8')
  let out
  try {
    out = ts.transpileModule(code, {
      compilerOptions: { module: 'CommonJS', target: 'ES2020' },
      fileName: file,
    })
  } catch (e) {
    console.error('转译失败:', file, e.message)
    throw e
  }
  const rel = path.relative(FRONT, file).replace(/\.ts$/, '.js')
  const dest = path.join(outDir, rel)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.writeFileSync(dest, out.outputText)
}

const Module = require('module')
const origResolve = Module._resolveFilename
Module._resolveFilename = function (request, ...rest) {
  if (request.startsWith('@/')) {
    request = path.join(outDir, request.slice(2))
  }
  return origResolve.call(this, request, ...rest)
}

// ---- 假 localStorage / window ----
const mem = new Map()
global.window = {
  localStorage: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  },
}

const store = require(path.join(outDir, 'data', 'local-store.js'))
const service = require(path.join(outDir, 'api', 'local-service.js'))
const storageKey = store.storageKey()

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`)
  }
}

function dumpRain() {
  return JSON.parse(mem.get(storageKey)).rainfall
}

// 首次访问触发播种与规范化回写。
service.listEntries('rainfall')

console.log('1) 旧数据规范化：seed 里 rainfall#2 状态「待审核」却 abnormal=true')
{
  const rain = dumpRain()
  const r2 = rain.find((r) => r.id === 2)
  check('待审核 pending=true', r2.pending === true, JSON.stringify(r2))
  check('待审核 abnormal 重算为 false', r2.abnormal === false, JSON.stringify(r2))
  const r3 = rain.find((r) => r.id === 3)
  check('已通过 pending=false', r3.pending === false)
  check('已通过 abnormal=false', r3.abnormal === false)
  check('无结论时不含 review 字段', r3.review === undefined)
}

console.log('2) 复核结论落库，刷新（清缓存重读）后仍在，原始观测值不变')
{
  const before = dumpRain().find((r) => r.id === 2)
  const rawPeriod = before['观测时段']
  const rawInterval = before['时段雨量']
  const rawDaily = before['日累计雨量']

  let res = service.runAction('rainfall', 2, '提交审核')
  check('已在待审核：动作幂等 ok', res.ok && res.duplicated === true, res.message)

  res = service.submitReview('rainfall', 2, {
    conclusion: '复核通过',
    reviewer: '张工',
    comment: '',
    checked: ['period', 'interval', 'daily', 'intensity', 'observer'],
  })
  check('复核提交成功', res.ok, res.message)
  let r2 = dumpRain().find((r) => r.id === 2)
  check('状态变为已通过', r2.status === '已通过')
  check('pending 离开待办', r2.pending === false)
  check('结论持久化', r2.review && r2.review.conclusion === '复核通过' && r2.review.reviewer === '张工')
  check('原始观测值未改动',
    r2['观测时段'] === rawPeriod && r2['时段雨量'] === rawInterval && r2['日累计雨量'] === rawDaily)

  // 模拟刷新：清掉模块内存缓存做不到（私有），改为直接重新解析存储——
  // local-store 缓存只在进程内有效，新页面即新进程，等价于重新 hydrate。
  const persisted = JSON.parse(mem.get(storageKey))
  check('localStorage 中确有结论', persisted.rainfall.find((r) => r.id === 2).review.conclusion === '复核通过')
}

console.log('3) 列表/导出/显示口径一致回显')
{
  const list = service.listEntries('rainfall').items
  const r2 = list.find((r) => r.id === 2)
  check('列表项带复核结论', r2.review?.conclusion === '复核通过')
  const csv = service.exportEntries('rainfall').content
  const line = csv.split('\n').find((l) => l.startsWith('2,'))
  check('CSV 含复核结论与复核人', line.includes('复核通过') && line.includes('张工'), line)
  check('CSV 表头不再有重复的记录状态列',
    csv.split('\n')[0].endsWith('编号,记录编号,站点编号,观测时段,时段雨量,日累计雨量,降雨强度,观测人,复核结论,复核人,复核时间,当前状态'),
    csv.split('\n')[0])
  const filtered = service.listEntries('rainfall', { 复核人: '张工' }).items
  check('可按复核人筛选', filtered.length === 1 && filtered[0].id === 2)
}

console.log('4) 重复复核只落一个结论；重新提交审核后旧结论清除（无残留）')
{
  const res = service.submitReview('rainfall', 2, {
    conclusion: '复核异常',
    reviewer: '李四',
    comment: '覆盖尝试',
    checked: ['period', 'interval', 'daily', 'intensity', 'observer'],
  })
  check('重复复核被幂等拦截', res.ok && res.duplicated === true, res.message)
  let r2 = dumpRain().find((r) => r.id === 2)
  check('结论保持原结论/原复核人', r2.review.conclusion === '复核通过' && r2.review.reviewer === '张工')
  check('状态仍为已通过', r2.status === '已通过')

  const back = service.runAction('rainfall', 2, '提交审核')
  check('重新提交审核成功', back.ok, back.message)
  r2 = dumpRain().find((r) => r.id === 2)
  check('旧结论已清除无残留', r2.review === undefined)
  check('状态回到待审核', r2.status === '待审核' && r2.pending === true)
}

console.log('5) 异常结论必填意见，清单须全勾')
{
  let res = service.submitReview('rainfall', 2, {
    conclusion: '复核异常', reviewer: '张工', comment: '',
    checked: ['period', 'interval', 'daily', 'intensity', 'observer'],
  })
  check('异常无意见被拒', !res.ok, res.message)
  res = service.submitReview('rainfall', 2, {
    conclusion: '复核异常', reviewer: '张工', comment: '日累计对不上',
    checked: ['period', 'interval'],
  })
  check('清单未全勾被拒', !res.ok, res.message)
  res = service.submitReview('rainfall', 2, {
    conclusion: '复核异常', reviewer: '张工', comment: '日累计对不上',
    checked: ['period', 'interval', 'daily', 'intensity', 'observer'],
  })
  check('异常复核成功', res.ok, res.message)
  const r2 = dumpRain().find((r) => r.id === 2)
  check('状态为异常值且 abnormal=true', r2.status === '异常值' && r2.abnormal === true)
}

console.log('6) 并发提交只生效一次')
{
  // #1 已采集 -> 先送审
  service.runAction('rainfall', 1, '提交审核')
  const input = {
    conclusion: '复核通过', reviewer: '王五', comment: '',
    checked: ['period', 'interval', 'daily', 'intensity', 'observer'],
  }
  const a = service.submitReview('rainfall', 1, input)
  const b = service.submitReview('rainfall', 1, { ...input, reviewer: '赵六' })
  check('首次成功', a.ok && !a.duplicated, a.message)
  check('并发第二次被拒/幂等', b.ok === true && b.duplicated === true, b.message)
  const r1 = dumpRain().find((r) => r.id === 1)
  check('只落了第一个结论', r1.review.reviewer === '王五')
}

console.log('7) 整编待办与列表 pending、看板同源')
{
  const todos = service.loadCompilationTodos()
  const rainTodo = todos.find((t) => t.module.key === 'rainfall')
  const rainRows = service.listEntries('rainfall').items
  const pendingCount = rainRows.filter((r) => r.pending).length
  check('整编待办雨量待办数=pending 数', rainTodo.pending === pendingCount, `${rainTodo.pending} vs ${pendingCount}`)
  const keys = todos.map((t) => t.module.key).sort()
  check('整编来源含 6 个观测模块', keys.length === 6 && keys.join(',') === 'discharge,evaporation,groundwater,rainfall,sediment,waterlevel', keys.join(','))
  const overview = service.loadOverview()
  const rainCard = overview.modules.find((m) => m.name === '雨量观测')
  check('看板雨量待处理=待办数', rainCard.pending === pendingCount)
  check('看板雨量异常量=异常记录数', rainCard.abnormal === rainRows.filter((r) => r.abnormal).length)
}

console.log('8) 脏存储/旧缺省字段自愈，未知模块保留')
{
  mem.set(storageKey, JSON.stringify({
    rainfall: [
      { id: 9, status: '已通过', pending: true, abnormal: true, 记录编号: 'X' }, // 旧标志位错误，无 review
      { id: 10, status: '待审核', review: { conclusion: '复核通过', reviewer: 'x' } }, // 脏结论（缺时间/非终态）
      { bogus: true }, // 整行坏掉
    ],
    unknownModule: [{ id: 1 }],
  }))
  // 新进程等价：重新 require 带缓存的模块不行，这里直接调规范化层。
  const norm = require(path.join(outDir, 'data', 'normalize.js'))
  const result = norm.normalizeStore(JSON.parse(mem.get(storageKey)))
  const rain = result.rows.rainfall
  check('坏行被剔除', rain.length === 2, String(rain.length))
  const r9 = rain.find((r) => r.id === 9)
  check('旧标志位重算 pending=false', r9.pending === false && r9.abnormal === false)
  check('无结论不造结论', r9.review === undefined)
  const r10 = rain.find((r) => r.id === 10)
  check('脏/非终态结论被清除', r10.review === undefined)
  check('未知模块保留', Array.isArray(result.rows.unknownModule))
}

console.log(`\n结果：${passed} 通过，${failed} 失败`)
fs.rmSync(outDir, { recursive: true, force: true })
process.exit(failed ? 1 : 0)
