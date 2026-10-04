import { createServer } from 'vite'

const vite = await createServer({ server: { middlewareMode: true }, logLevel: 'error' })

let passed = 0
function assert(name, condition, detail = '') {
  if (!condition) {
    console.error(`✗ ${name} ${detail}`)
    process.exitCode = 1
  } else {
    passed++
    console.log(`✓ ${name}`)
  }
}

try {
  const store = await vite.ssrLoadModule('/src/data/local-store.ts')
  const reviewApi = await vite.ssrLoadModule('/src/api/review.ts')
  const service = await vite.ssrLoadModule('/src/api/local-service.ts')

  // 1. 旧缺省字段迁移：种子行没有 review/compiled 键，读取后被补齐，原始观测值未被改。
  const rainRows = store.listRows('rainfall')
  assert('迁移后每条雨量行都有 review 字段', rainRows.every((r) => 'review' in r))
  assert('迁移后每条雨量行都有 compiled 字段', rainRows.every((r) => 'compiled' in r))
  const r1 = rainRows.find((r) => r.id === 1)
  assert('旧行 review 缺省为 null', r1.review === null)
  assert('原始观测值保留：时段雨量 12.4', r1['时段雨量'] === 12.4)
  assert('原始观测值保留：观测人 李长水', r1['观测人'] === '李长水')
  assert('待审核行 pending=true', r1.pending === true)
  assert('已通过行 pending=false', rainRows.find((r) => r.id === 3).pending === false)
  assert('异常行 abnormal=true', rainRows.find((r) => r.id === 5).abnormal === true)

  // 2. 字符串数字兼容解析
  assert('parseAmount 支持字符串数字', reviewApi.parseAmount('12.4mm') === 12.4)
  assert('parseAmount 无法解析返回 null', reviewApi.parseAmount('雨量观测样例') === null)

  // 3. 日累计核对：id=1 站点 STAT-0101 当日两段 12.4+14.4=26.8
  const check1 = reviewApi.checkDailyRain(r1)
  assert('日累计核对一致', check1.consistent === true, `sum=${check1.sumPeriod} daily=${check1.dailyRain}`)
  const r5 = rainRows.find((r) => r.id === 5)
  const check5 = reviewApi.checkDailyRain(r5)
  assert('日累计核对能发现不一致(31 vs 18.2)', check5.consistent === false)

  // 4. 提交复核：落结论、状态变已通过、进入待整编
  const fullChecks = { check0: true, check1: true, check2: true, check3: true, check4: true }
  const res1 = await reviewApi.submitReview('rainfall', 1, {
    checks: fullChecks, verdict: '通过', reviewer: '测试员', remark: 'ok',
  })
  assert('首次复核成功', res1.ok === true, res1.message)
  const after1 = reviewApi.getEntry('rainfall', 1)
  assert('结论已落行', after1.review?.verdict === '通过' && after1.review?.reviewer === '测试员')
  assert('revision 从 1 开始', after1.review.revision === 1)
  assert('状态变为已通过', after1.status === '已通过')
  const todosAfterPass = reviewApi.pendingCompilationTodos().map((t) => t.id)
  assert('通过后进入整编待办', todosAfterPass.includes(1))
  assert('异常记录不进待办', !todosAfterPass.includes(5))

  // 5. 刷新等价：重新走规范化读取（模拟刷新，缓存保持即同一 localStorage）
  const reread = reviewApi.getEntry('rainfall', 1)
  assert('重新读取后结论仍在', reread.review?.verdict === '通过' && reread.review?.remark === 'ok')

  // 6. 完全相同的重复提交：幂等，不新增 revision
  const resDup = await reviewApi.submitReview('rainfall', 1, {
    checks: fullChecks, verdict: '通过', reviewer: '测试员', remark: 'ok',
  })
  assert('相同重复提交幂等成功', resDup.ok === true)
  assert('幂等不产生第二版', reviewApi.getEntry('rainfall', 1).review.revision === 1)

  // 7. 内容不同的重复复核：仍是同一条结论，revision +1
  const resEdit = await reviewApi.submitReview('rainfall', 1, {
    checks: fullChecks, verdict: '异常', reviewer: '测试员', remark: '发现疑点',
  })
  assert('改判成功', resEdit.ok === true)
  const afterEdit = reviewApi.getEntry('rainfall', 1)
  assert('只保留一条结论且 revision=2', afterEdit.review.revision === 2 && afterEdit.review.verdict === '异常')
  assert('改判异常后状态为异常值', afterEdit.status === '异常值' && afterEdit.abnormal === true)
  assert('异常后退出整编待办', !reviewApi.pendingCompilationTodos().map((t) => t.id).includes(1))

  // 8. 并发提交只生效一次（同事件循环内两个并发调用）
  await reviewApi.submitReview('rainfall', 6, {
    checks: fullChecks, verdict: '通过', reviewer: '初始', remark: 'first',
  })
  const [a, b] = await Promise.all([
    reviewApi.submitReview('rainfall', 6, { checks: fullChecks, verdict: '异常', reviewer: '并发A', remark: 'A' }),
    reviewApi.submitReview('rainfall', 6, { checks: fullChecks, verdict: '异常', reviewer: '并发B', remark: 'B' }),
  ])
  const winner = reviewApi.getEntry('rainfall', 6)
  assert('并发两次都有结果返回', a.ok === true && b.ok === true, `a=${a.ok} b=${b.ok}`)
  assert('并发只落一个结论 revision=2', winner.review.revision === 2, `rev=${winner.review.revision}`)
  assert('只有先到的提交生效', winner.review.reviewer === '并发A', `reviewer=${winner.review.reviewer}`)

  // 9. 核对清单未勾完不能提交
  const resIncomplete = await reviewApi.submitReview('rainfall', 2, {
    checks: { check0: true }, verdict: '通过', reviewer: '测试员', remark: '',
  })
  assert('清单未完成时拒绝提交', resIncomplete.ok === false)
  assert('被拒后记录维持原状(待审核)', reviewApi.getEntry('rainfall', 2).status === '待审核')

  // 10. 通用动作不冲掉结论
  store.saveRows('rainfall', store.listRows('rainfall').map((r, i) => r)) // noop
  await reviewApi.submitReview('rainfall', 2, {
    checks: fullChecks, verdict: '通过', reviewer: '测试员', remark: 'x',
  })
  service.runAction('rainfall', 2, '标记异常')
  const afterAction = reviewApi.getEntry('rainfall', 2)
  assert('状态流转后复核结论保留', afterAction.review?.verdict === '通过' && afterAction.status === '异常值')

  // 11. 整编：编入成果幂等、待办消失、与列表统计同源
  const beforeTodo = reviewApi.pendingCompilationTodos().map((t) => t.id)
  const targetId = beforeTodo[0]
  const c1 = reviewApi.markCompiled(targetId)
  const c2 = reviewApi.markCompiled(targetId)
  assert('首次编入成功', c1.ok === true)
  assert('重复编入幂等', c2.ok === true)
  assert('编入后从待办消失', !reviewApi.pendingCompilationTodos().map((t) => t.id).includes(targetId))
  assert('compilationTodos 仍能查到该记录且 compiled=true',
    reviewApi.compilationTodos().find((t) => t.id === targetId)?.compiled === true)

  // 12. 报表与列表同源：服务层过滤口径一致
  const listPayload = service.listEntries('rainfall', { '站点编号': 'STAT-0101' })
  assert('列表筛选口径按站点命中', listPayload.items.length === 2 && listPayload.total === 2)

  // 13. 跨模块通用复核（断面 -> 已校核/需重测 状态映射）
  const xsRes = await reviewApi.submitReview('crosssection', 1, {
    checks: { check0: true, check1: true, check2: true, check3: true, check4: true },
    verdict: '通过', reviewer: '校核员', remark: '',
  })
  assert('断面校核走通用复核', xsRes.ok === true)
  assert('断面通过态映射为已校核', reviewApi.getEntry('crosssection', 1).status === '已校核')

  console.log(`\n${passed} 项断言全部通过`)
} finally {
  await vite.close()
}
