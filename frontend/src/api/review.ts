import { moduleMeta } from './local-service'
import { listRows, saveRows } from '@/data/local-store'
import type { ActionResult, CompilationTodo, DailyRainCheck, EntryRow, ReviewConclusion, ReviewVerdict } from '@/data/types'

export type { CompilationTodo } from '@/data/types'

export type ReviewInput = {
  checks: Record<string, boolean>
  verdict: ReviewVerdict
  reviewer: string
  remark: string
}

// 每条记录一把串行锁：并发提交只有第一个能落结论，其余直接拿到幂等结果。
const inflight = new Map<string, Promise<ActionResult>>()

export function getEntry(key: string, id: number): EntryRow | null {
  const rows = listRows(key)
  const found = rows.find((row) => Number(row.id) === id)
  return found ? { ...found } : null
}

/** 把「12.4」「12.4mm」之类的原始值解析成数值；无法解析返回 null，绝不臆造数字。 */
export function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null
  }
  if (typeof value === 'string') {
    const matched = value.trim().match(/-?\d+(?:\.\d+)?/)
    if (!matched) {
      return null
    }
    const parsed = Number(matched[0])
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function dayOf(period: string): string {
  // 观测时段形如「2026-09-03 08:00-14:00」；旧数据可能只有日期，取前 10 位即可。
  return String(period ?? '').slice(0, 10)
}

/**
 * 日累计核对：同一站点、同一天各时段雨量之和应等于当日日累计。
 * 只做读取与比对，不改任何原始观测值。
 */
export function checkDailyRain(target: EntryRow, all: EntryRow[] = listRows('rainfall')): DailyRainCheck {
  const stationNo = String(target['站点编号'] ?? '')
  const day = dayOf(String(target['观测时段'] ?? ''))
  const parts = all
    .filter((row) => String(row['站点编号'] ?? '') === stationNo && dayOf(String(row['观测时段'] ?? '')) === day)
    .map((row) => ({
      id: Number(row.id),
      period: String(row['观测时段'] ?? ''),
      amount: parseAmount(row['时段雨量']),
    }))
  const amounts = parts.map((part) => part.amount)
  const sumPeriod = amounts.some((amount) => amount === null)
    ? null
    : Math.round((amounts as number[]).reduce((sum, amount) => sum + amount, 0) * 100) / 100
  const dailyRain = parseAmount(target['日累计雨量'])
  const consistent =
    dailyRain === null || sumPeriod === null
      ? null
      : Math.abs(dailyRain - sumPeriod) <= 0.01
  return { day, stationNo, dailyRain, sumPeriod, consistent, parts }
}

function sameConclusion(existing: ReviewConclusion | null | undefined, input: ReviewInput): boolean {
  if (!existing) {
    return false
  }
  const prevChecks = existing.checks
  const nextChecks = input.checks
  const keys = new Set([...Object.keys(prevChecks), ...Object.keys(nextChecks)])
  for (const key of keys) {
    if (Boolean(prevChecks[key]) !== Boolean(nextChecks[key])) {
      return false
    }
  }
  return (
    existing.verdict === input.verdict &&
    existing.reviewer === input.reviewer.trim() &&
    existing.remark === input.remark.trim()
  )
}

function nowLabel(): string {
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 提交复核结论。
 * - 结论直接落在业务行上并整行持久化，刷新 / 重进 / 返回都从同一份数据回显；
 * - 重复复核只覆盖同一条结论（revision +1），不会留下多条；
 * - 完全相同的重复提交走幂等，返回成功但不重复落库；
 * - 并发（含同一事件循环里的重入）提交只有第一个生效。
 */
export function submitReview(key: string, id: number, input: ReviewInput): Promise<ActionResult> {
  const lockKey = `${key}:${id}`
  const running = inflight.get(lockKey)
  if (running) {
    // 真正并发（同步重入或进行中的异步）：挂到首提交上，只有首个结论生效。
    return running.then((result) => ({ ...result, message: `复核正在提交中，已按首次提交生效：${result.message}` }))
  }
  const apply = (): ActionResult => {
    const meta = moduleMeta(key)
    const requiredVerdicts = meta.reviewVerdicts ?? ['通过', '异常']
    if (!requiredVerdicts.includes(input.verdict)) {
      return { ok: false, message: '请选择有效的复核结论' }
    }
    const reviewer = input.reviewer.trim()
    if (!reviewer) {
      return { ok: false, message: '请填写复核人' }
    }
    const checklist = meta.checklist ?? []
    if (checklist.length > 0) {
      const unchecked = checklist.filter((_, index) => !input.checks[`check${index}`])
      if (unchecked.length > 0) {
        return { ok: false, message: `还有 ${unchecked.length} 项核对清单未确认，不能提交复核` }
      }
    }

    const rows = listRows(key)
    const index = rows.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
    }
    const current = rows[index]
    const existing = current.review ?? null
    const normalizedInput: ReviewInput = { ...input, reviewer, remark: input.remark.trim() }

    // 幂等：内容完全一致的重复提交直接成功，不再落第二条结论。
    if (existing && sameConclusion(existing, normalizedInput)) {
      return { ok: true, message: `复核结论与现有结论一致，无需重复提交（第 ${existing.revision} 版）` }
    }

    const targetStatus =
      meta.reviewTargets?.[input.verdict] ?? (input.verdict === '通过' ? '已通过' : '异常值')
    const conclusion: ReviewConclusion = {
      checks: { ...input.checks },
      verdict: input.verdict,
      reviewer,
      remark: input.remark.trim(),
      concludedAt: nowLabel(),
      revision: (existing?.revision ?? 0) + 1,
    }
    const updated: EntryRow = {
      ...current,
      review: conclusion,
      status: targetStatus,
      abnormal: input.verdict === '异常',
      pending: false,
      // 通过后等待整编；异常记录不进整编待办。
      ...(key === 'rainfall'
        ? { compiled: input.verdict === '通过' ? current.compiled === true : false }
        : {}),
    }
    const next = [...rows]
    next[index] = updated
    saveRows(key, next)
    return { ok: true, message: `复核结论「${input.verdict}」已保存（第 ${conclusion.revision} 版），刷新后仍保留` }
  }

  // 先占锁，再把业务体排到微任务：保证同 tick 的重入一定撞上锁、执行完一定释放。
  const task = Promise.resolve().then(() => {
    try {
      return apply()
    } finally {
      inflight.delete(lockKey)
    }
  })
  inflight.set(lockKey, task)
  return task
}

// ── 整编待办：与雨量列表、打印报表同源，按已通过且未整编的雨量记录计算 ──

export function compilationTodos(): CompilationTodo[] {
  return listRows('rainfall')
    .filter((row) => String(row.status) === '已通过' && row.review?.verdict === '通过')
    .map((row) => ({
      id: Number(row.id),
      recordNo: String(row['记录编号'] ?? ''),
      stationNo: String(row['站点编号'] ?? ''),
      period: String(row['观测时段'] ?? ''),
      periodRain: parseAmount(row['时段雨量']),
      dailyRain: parseAmount(row['日累计雨量']),
      reviewer: row.review?.reviewer ?? '',
      concludedAt: row.review?.concludedAt ?? '',
      compiled: row.compiled === true,
    }))
}

export function pendingCompilationTodos(): CompilationTodo[] {
  return compilationTodos().filter((item) => !item.compiled)
}

/** 把一条已通过的雨量记录编入成果；重复调用幂等，只生效一次。 */
export function markCompiled(id: number): ActionResult {
  const rows = listRows('rainfall')
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的雨量记录` }
  }
  const current = rows[index]
  if (String(current.status) !== '已通过' || current.review?.verdict !== '通过') {
    return { ok: false, message: '只有复核通过的雨量记录才能编入成果' }
  }
  if (current.compiled === true) {
    return { ok: true, message: '该记录已编入整编成果，无需重复操作' }
  }
  const next = [...rows]
  next[index] = { ...current, compiled: true }
  saveRows('rainfall', next)
  return { ok: true, message: `雨量记录 ${current['记录编号'] ?? id} 已编入整编成果` }
}
