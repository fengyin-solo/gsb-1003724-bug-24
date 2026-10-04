import { SEED_ROWS } from './seed'
import type { EntryRow, ReviewConclusion } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'hydrology-monitor-station:entries'

// 结论落库后不再作为待办；异常态一律标红。其余中间态都算待处理。
const SETTLED_STATUSES = ['已通过', '已校核', '已复核', '已刊印', '已合格', '已验收', '已完成', '已处置', '已批准', '已生效', '正常运行', '通讯正常', '已撤销', '已停用']
const ABNORMAL_STATUSES = ['异常值', '不合格', '需重测', '设备故障', '信号异常', '通讯中断', '低电量', '待维修', '待更换', '发现故障', '已驳回', '已废止', '需检修', '暂停运行', '已撤销', '已停用']

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function isReview(value: unknown): value is ReviewConclusion {
  if (typeof value !== 'object' || value === null) {
    return false
  }
  const candidate = value as Partial<ReviewConclusion>
  return (
    typeof candidate.verdict === 'string' &&
    typeof candidate.reviewer === 'string' &&
    typeof candidate.concludedAt === 'string'
  )
}

/**
 * 旧数据兼容：只补齐控制字段（review / compiled / pending / abnormal），
 * 不改动任何原始观测字段。这样刷新、升级版本后旧行仍能走同一套回显与待办逻辑。
 */
export function normalizeRow(key: string, row: EntryRow): EntryRow {
  const normalized: EntryRow = { ...row }
  // 缺省字段：没有复核结论就是 null（旧版本行里根本没有这个键）。
  normalized.review = isReview(normalized.review) ? normalized.review : null
  if (key === 'rainfall') {
    // 雨量整编标记缺省为未整编；已通过的记录才可能进入整编待办。
    normalized.compiled = normalized.compiled === true
  }
  const status = String(normalized.status)
  const hasConclusion = normalized.review !== null
  if (SETTLED_STATUSES.includes(status)) {
    normalized.pending = false
  } else if (ABNORMAL_STATUSES.includes(status)) {
    normalized.pending = false
    normalized.abnormal = true
  } else {
    normalized.pending = true
  }
  if (ABNORMAL_STATUSES.includes(status) || (hasConclusion && normalized.review?.verdict === '异常')) {
    normalized.abnormal = true
  }
  if (status === '已通过' || (hasConclusion && normalized.review?.verdict === '通过')) {
    normalized.abnormal = false
  }
  return normalized
}

function normalizeAll(data: Record<string, EntryRow[]>): Record<string, EntryRow[]> {
  const result: Record<string, EntryRow[]> = {}
  for (const [key, rows] of Object.entries(data)) {
    result[key] = Array.isArray(rows) ? rows.map((row) => normalizeRow(key, row)) : []
  }
  return result
}

function readStorage(): Record<string, EntryRow[]> {
  const fallback = normalizeAll(clone(SEED_ROWS))
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    // 用户改动优先，但每行都过一遍迁移，补齐旧版本缺省字段（原始观测值原样保留）。
    const parsed = JSON.parse(raw) as Record<string, EntryRow[]>
    return normalizeAll({ ...clone(SEED_ROWS), ...parsed })
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: Record<string, EntryRow[]> | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function saveRows(key: string, rows: EntryRow[]): void {
  // 落库前再过一遍规范化，避免调用方漏掉缺省字段导致刷新后回显不一致。
  const clean = rows.map((row) => normalizeRow(key, row))
  const next = { ...allRows(), [key]: clean }
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function resetRows(key: string): EntryRow[] {
  const rows = normalizeAll(clone(SEED_ROWS))[key] ?? []
  saveRows(key, rows)
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
