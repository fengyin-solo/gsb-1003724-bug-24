// 复核流页面共用出口：列表页/详情页/整编页都从这里取服务与打印工具，
// 保证「复核与回显」只有一条数据通道。
export {
  displayColumns,
  displayValue,
  downloadEntries,
  exportEntries,
  filterRows,
  getEntry,
  listEntries,
  loadCompilationTodos,
  moduleMeta,
  runAction,
  submitReview,
} from '@/api/local-service'
export type { CompilationTodoItem } from '@/api/local-service'
export { printReport } from '@/utils/print'
