import { getRow, listRows, resetRows, saveRows } from '@/data/local-store'
import { doneStatuses, isAbnormal, isPending } from '@/data/normalize'
import { MODULE_BY_KEY, MODULES } from '@/data/modules'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  ReviewInput,
} from '@/data/types'

// Excel 识别 UTF-8 CSV 需要的字节序标记。
const BOM = String.fromCharCode(0xfeff)

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

// 复核流页面在列表里多展示的回显列：与打印报表、CSV 导出取同一组字段。
const REVIEW_COLUMNS = ['复核结论', '复核人', '复核时间'] as const
const STATUS_COLUMN_SUFFIX = '状态'

// 各模块业务字段里以「状态」结尾的列与独立的「当前状态」语义重复，列表/打印统一剔除，
// 保证列表和打印报表列头一致。
export function displayColumns(meta: ModuleMeta): string[] {
  const fields = meta.fields.filter((field) => !field.endsWith(STATUS_COLUMN_SUFFIX))
  return meta.reviewable ? [...fields, ...REVIEW_COLUMNS] : fields
}

function formatTime(iso: string | undefined): string {
  if (!iso) {
    return ''
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

// 列表单元格、打印报表、CSV 导出共用的回显口径：复核结论只从 row.review 这一个来源取。
export function displayValue(row: EntryRow, column: string): string {
  switch (column) {
    case '复核结论':
      return row.review?.conclusion ?? ''
    case '复核人':
      return row.review?.reviewer ?? ''
    case '复核时间':
      return formatTime(row.review?.reviewedAt)
    default:
      return row[column] === undefined || row[column] === null ? '' : String(row[column])
  }
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => {
      if (REVIEW_COLUMNS.includes(field as typeof REVIEW_COLUMNS[number])) {
        return displayValue(row, field).includes(value.trim())
      }
      return String(row[field] ?? '').includes(value.trim())
    }),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function getEntry(key: string, id: number): EntryRow | undefined {
  return getRow(key, id)
}

// 状态一变化，旧结论即作废：pending/abnormal 按元数据状态集合推导，不再沿用行内旧标志位。
function applyStatusChange(
  meta: ModuleMeta,
  row: EntryRow,
  target: string,
): EntryRow {
  const next: EntryRow = {
    ...row,
    status: target,
    pending: isPending(meta, target),
    abnormal: isAbnormal(meta, target),
  }
  if (!doneStatuses(meta).has(target)) {
    delete next.review
  }
  return next
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    // 幂等：重复动作直接返回当前状态，不覆盖任何结论，也不产生新记录。
    return {
      ok: true,
      duplicated: true,
      message: `${meta.entity}已经是「${target}」，无需重复操作`,
    }
  }
  const next = [...rows]
  next[index] = applyStatusChange(meta, rows[index], target)
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 进行中的复核提交锁：同一时刻同一模块同一记录只允许一个提交生效。
const submittingKeys = new Set<string>()

function lockKey(key: string, id: number): string {
  return `${key}:${id}`
}

/**
 * 提交复核结论。
 * - 只有已进入待复核状态（待审核）或终态补录的记录可提交；已采集须先提交审核。
 * - 终态且已有结论的记录不允许覆盖，保证重复复核只落一个结论；如需重审走「提交审核」。
 * - 并发提交（同步重入/双击）第二请求直接拒绝，只生效一次。
 * - 结论决定终态（通过/异常），结论随记录持久化，原始观测值一律不动。
 */
export function submitReview(
  key: string,
  id: number,
  input: ReviewInput,
): ActionResult {
  const meta = moduleMeta(key)
  if (!meta.reviewable) {
    return { ok: false, message: `${meta.entity}不在统一复核范围内` }
  }
  const conclusions = meta.reviewConclusions ?? []
  const conclusion = input.conclusion?.trim()
  if (!conclusions.includes(conclusion)) {
    return { ok: false, message: '请选择有效的复核结论' }
  }
  const checklist = meta.checklist ?? []
  const checked = [...new Set(input.checked)]
  if (checklist.some((item) => !checked.includes(item.id))) {
    return { ok: false, message: '请逐项核对清单并全部勾选后再提交' }
  }
  const reviewer = input.reviewer?.trim()
  if (!reviewer) {
    return { ok: false, message: '请填写复核人' }
  }
  const comment = input.comment?.trim() ?? ''
  const abnormalConclusions = new Set(meta.abnormalConclusions ?? [])
  if (abnormalConclusions.has(conclusion) && !comment) {
    return { ok: false, message: '复核异常时必须填写复核意见，说明异常情况与处理建议' }
  }

  const token = lockKey(key, id)
  if (submittingKeys.has(token)) {
    return { ok: false, message: '该记录正在提交中，请勿重复提交' }
  }
  submittingKeys.add(token)
  try {
    // 行数据与终态判断都放在锁内：杜绝锁外预读导致的 TOCTOU，只放第一个提交落库。
    const rows = listRows(key)
    const index = rows.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
    }
    const current = rows[index]
    if (current.review && doneStatuses(meta).has(current.status)) {
      return {
        ok: true,
        duplicated: true,
        message: '该记录已复核，结论保持不变；如需修改请先重新提交审核',
      }
    }
    if (current.status !== '待审核' && !doneStatuses(meta).has(current.status)) {
      return { ok: false, message: `记录当前为「${current.status}」，请先提交审核再复核` }
    }
    const abnormalSet = new Set(meta.abnormalConclusions ?? [])
    // 复核流模块终态固定为「已通过 / 异常值」；异常结论落异常态，其余落第一个通过态。
    const passedStatus = (meta.doneStatuses ?? [])
      .find((status) => !(meta.abnormalStatuses ?? []).includes(status))
      ?? meta.statuses[meta.statuses.length - 1]
    const target = abnormalSet.has(conclusion)
      ? meta.abnormalStatuses?.[0] ?? passedStatus
      : passedStatus
    const updated: EntryRow = {
      ...current,
      status: target,
      pending: isPending(meta, target),
      abnormal: isAbnormal(meta, target),
      review: {
        conclusion,
        reviewer,
        comment,
        checked,
        reviewedAt: new Date().toISOString(),
      },
    }
    const next = [...rows]
    next[index] = updated
    saveRows(key, next)
    return { ok: true, message: `复核结论「${conclusion}」已保存，当前状态「${target}」` }
  } finally {
    submittingKeys.delete(token)
  }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

// 导出与打印共用同一份列与取值口径，避免列表一套、报表一套。
export function exportEntries(key: string, filters: Record<string, string> = {}): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const columns = displayColumns(meta)
  const header = ['编号', ...columns, '当前状态']
  const lines = [header.join(',')]
  for (const row of filterRows(listRows(key), filters)) {
    const cells = ['编号', ...columns].map((column) =>
      (column === '编号' ? String(row.id) : displayValue(row, column)).replace(/,/g, '，'),
    )
    cells.push(row.status)
    lines.push(cells.join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `${BOM}${lines.join('\n')}` }
}

export function downloadEntries(key: string, filters: Record<string, string> = {}): void {
  const { filename, content } = exportEntries(key, filters)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// 整编待办：各整编来源模块里 pending 的观测记录，全部由规范化后的状态推导，
// 与列表状态、看板「待处理」同源，不再各算各的。
export type CompilationTodoItem = {
  module: ModuleMeta
  pending: number
  reviewed: number
  abnormal: number
  total: number
  items: EntryRow[]
}

export function loadCompilationTodos(): CompilationTodoItem[] {
  return MODULES.filter((meta) => meta.compilationSource).map((meta) => {
    const rows = listRows(meta.key)
    const pending = rows.filter((row) => row.pending)
    return {
      module: meta,
      pending: pending.length,
      reviewed: rows.filter((row) => Boolean(row.review)).length,
      abnormal: rows.filter((row) => row.abnormal).length,
      total: rows.length,
      items: pending,
    }
  })
}

export function loadOverview(): OverviewResult {
  const modules = MODULES.map((meta) => {
    const entries = listRows(meta.key)
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}
