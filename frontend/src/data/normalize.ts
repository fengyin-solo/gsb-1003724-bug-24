import { MODULE_BY_KEY, MODULES } from './modules'
import type { EntryRow, ModuleMeta, ReviewRecord } from './types'

// 终态：进入这些状态就离开待办。元数据未声明时兼容旧约定，取状态流的最后一个。
export function doneStatuses(meta: ModuleMeta): Set<string> {
  const list = meta.doneStatuses ?? [meta.statuses[meta.statuses.length - 1]]
  return new Set(list.filter((item): item is string => Boolean(item)))
}

// 异常态：进入这些状态计入异常量。未声明时为空，不再按动作动词猜。
export function abnormalStatuses(meta: ModuleMeta): Set<string> {
  return new Set(meta.abnormalStatuses ?? [])
}

export function isPending(meta: ModuleMeta, status: string): boolean {
  return !doneStatuses(meta).has(status)
}

export function isAbnormal(meta: ModuleMeta, status: string): boolean {
  return abnormalStatuses(meta).has(status)
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  return undefined
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined
}

function validDate(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value))
}

// 清洗一条复核结论：只接受结构完整、结论合法、清单 id 全部对得上元数据的记录。
// 记录不在终态（例如被重新提交审核）时，旧结论一律视为残留并清掉。
function sanitizeReview(
  meta: ModuleMeta,
  status: string,
  raw: unknown,
): ReviewRecord | undefined {
  if (!meta.reviewable || !doneStatuses(meta).has(status)) {
    return undefined
  }
  const data = asRecord(raw)
  if (!data) {
    return undefined
  }
  const conclusion = nonEmptyString(data.conclusion)
  const reviewer = nonEmptyString(data.reviewer)
  const reviewedAt = validDate(data.reviewedAt) ? String(data.reviewedAt) : undefined
  if (
    !conclusion ||
    !reviewer ||
    !reviewedAt ||
    !meta.reviewConclusions?.includes(conclusion)
  ) {
    return undefined
  }
  const allowedIds = new Set((meta.checklist ?? []).map((item) => item.id))
  const checked = Array.isArray(data.checked)
    ? [...new Set(data.checked.filter((id): id is string =>
        typeof id === 'string' && allowedIds.has(id)))]
    : []
  const comment = typeof data.comment === 'string' ? data.comment.trim() : ''
  return { conclusion, reviewer, comment, checked, reviewedAt }
}

function normalizeRow(meta: ModuleMeta, raw: unknown): EntryRow | undefined {
  const data = asRecord(raw)
  if (!data) {
    return undefined
  }
  const id = Number(data.id)
  if (!Number.isFinite(id)) {
    return undefined
  }
  const status = typeof data.status === 'string' ? data.status : ''
  const review = sanitizeReview(meta, status, data.review)
  const row: EntryRow = {
    ...(data as EntryRow),
    id,
    status,
    pending: isPending(meta, status),
    abnormal: isAbnormal(meta, status),
  }
  if (review) {
    row.review = review
  } else {
    delete row.review
  }
  return row
}

/**
 * 规范化整库数据：旧缺省字段在这里补齐（pending/abnormal 一律由状态重新推导，
 * 复核结论做结构校验），原始观测字段原样保留。返回 changed=true 时调用方应回写存储。
 */
export function normalizeStore(
  input: Record<string, unknown>,
): { rows: Record<string, EntryRow[]>; changed: boolean } {
  const rows: Record<string, EntryRow[]> = {}
  let changed = false
  for (const meta of MODULES) {
    const source = Array.isArray(input[meta.key]) ? (input[meta.key] as unknown[]) : []
    if (!Array.isArray(input[meta.key])) {
      changed = true
    }
    const normalized: EntryRow[] = []
    for (const raw of source) {
      const row = normalizeRow(meta, raw)
      if (!row) {
        changed = true
        continue
      }
      // 与规范化前逐项比对，发现旧标志位或脏结论即标记回写。
      if (JSON.stringify(raw) !== JSON.stringify(row)) {
        changed = true
      }
      normalized.push(row)
    }
    rows[meta.key] = normalized
  }
  const known = new Set(MODULES.map((meta) => meta.key))
  for (const key of Object.keys(input)) {
    if (!known.has(key)) {
      rows[key] = input[key] as EntryRow[]
    }
  }
  return { rows, changed }
}

/** 供写路径在落库前统一使用的状态推导，避免各动作各算各的。 */
export function metaForKey(key: string): ModuleMeta | undefined {
  return MODULE_BY_KEY.get(key)
}
