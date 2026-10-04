/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

/** 复核结论随记录持久化：列表、复核详情、打印报表、整编待办都从同一份数据回显。 */
export type ReviewRecord = {
  /** 结论，取值来自模块元数据 reviewConclusions（如「复核通过」「复核异常」） */
  conclusion: string
  /** 复核人 */
  reviewer: string
  /** 复核意见 */
  comment: string
  /** 核对清单中已逐项打勾的条目 id */
  checked: string[]
  /** 复核时间，ISO 字符串 */
  reviewedAt: string
}

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  /** 已落结论的复核记录；未复核的旧数据缺省为 undefined，不改动原始观测值 */
  review?: ReviewRecord
  [field: string]: string | number | boolean | ReviewRecord | undefined
}

/** 核对清单条目：id 作为结论里持久化的勾选项，label 是界面与打印用文案 */
export type ChecklistItem = {
  id: string
  label: string
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
  /** 终态集合：进入这些状态即离开待办。缺省取 statuses 的最后一个 */
  doneStatuses?: string[]
  /** 异常态集合：处于这些状态的记录计入异常量。缺省为空 */
  abnormalStatuses?: string[]
  /** 是否走统一复核流（列表可进复核详情、有核对清单、进整编待办） */
  reviewable?: boolean
  /** 详情页重点展示的原始观测字段（观测时段/时段雨量/日累计雨量等） */
  reviewFocusFields?: string[]
  /** 可落的复核结论，顺序即详情页单选项顺序 */
  reviewConclusions?: string[]
  /** 结论为异常类时复核意见必填；这里列出哪些结论算异常结论 */
  abnormalConclusions?: string[]
  /** 复核核对清单 */
  checklist?: ChecklistItem[]
  /** 是否计入数据整编待办 */
  compilationSource?: boolean
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
  /** 幂等命中（记录已是该状态 / 已存在结论）时为 true，便于页面静默回显 */
  duplicated?: boolean
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 复核提交入参：checked 为核对清单已勾选项 id */
export type ReviewInput = {
  conclusion: string
  reviewer: string
  comment: string
  checked: string[]
}
