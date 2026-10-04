/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type ReviewVerdict = '通过' | '异常'

export type ReviewConclusion = {
  /** 核对清单各项 key -> 是否核对通过 */
  checks: Record<string, boolean>
  verdict: ReviewVerdict
  reviewer: string
  remark: string
  /** 提交时的时间戳，用于回显与排序 */
  concludedAt: string
  /** 第几次落结论，重复复核会覆盖同一条结论而不是新增 */
  revision: number
}

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  /** 观测类模块的复核结论；没有结论的旧记录缺省为 null */
  review?: ReviewConclusion | null
  /** 雨量记录通过复核后是否已进入整编成果 */
  compiled?: boolean
  [field: string]: string | number | boolean | ReviewConclusion | null | undefined
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
  /** 复核详情页的核对清单（观测类整编模块使用） */
  checklist?: string[]
  /** 支持的复核结论，缺省为「通过 / 异常」 */
  reviewVerdicts?: ReviewVerdict[]
  /** 结论对应的目标状态，缺省为 已通过 / 异常值 */
  reviewTargets?: Partial<Record<ReviewVerdict, string>>
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
}

export type CompilationTodo = {
  id: number
  recordNo: string
  stationNo: string
  period: string
  periodRain: number | null
  dailyRain: number | null
  reviewer: string
  concludedAt: string
  compiled: boolean
}

export type DailyRainCheck = {
  day: string
  stationNo: string
  dailyRain: number | null
  sumPeriod: number | null
  /** true=一致，false=不一致，null=缺数值无法核对 */
  consistent: boolean | null
  parts: { id: number; period: string; amount: number | null }[]
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}
