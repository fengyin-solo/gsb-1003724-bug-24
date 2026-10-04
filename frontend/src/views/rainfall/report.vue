<template>
  <section class="page report-page" data-module="rainfall-report">
    <header class="page-head report-head no-print">
      <div>
        <h2>雨量观测复核报表</h2>
        <p class="page-desc">与雨量列表同一数据源、同一筛选口径，供打印或导出 CSV 存档。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="goBack">返回列表</button>
        <button class="btn primary" type="button" @click="doPrint">打印报表</button>
        <button class="btn" type="button" @click="doExport">导出 CSV</button>
      </div>
    </header>

    <article class="report-sheet">
      <header class="sheet-head">
        <h2 class="sheet-title">雨量观测复核报表</h2>
        <p class="sheet-meta">
          站点编号：{{ filters['站点编号'] || '全部' }} ｜
          观测时段：{{ filters['观测时段'] || '全部' }} ｜
          记录状态：{{ statusFilter || '全部' }} ｜
          打印时间：{{ printedAt }}
        </p>
      </header>

      <table class="data-table report-table">
        <thead>
          <tr>
            <th v-for="column in reportColumns" :key="column">{{ column }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="row in rows" :key="String(row.id)">
            <td v-for="column in reportColumns" :key="column">{{ formatCell(row, column) }}</td>
          </tr>
          <tr v-if="!rows.length">
            <td :colspan="reportColumns.length" class="empty-state">当前筛选条件下没有雨量记录</td>
          </tr>
        </tbody>
      </table>

      <footer class="sheet-foot">
        <span>共 {{ rows.length }} 条；复核通过 {{ passCount }} 条；异常 {{ abnormalCount }} 条；待整编 {{ pendingCompileCount }} 条</span>
        <span>复核人（签字）：__________　整编人（签字）：__________</span>
      </footer>
    </article>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import { downloadEntries, listEntries, moduleMeta } from '@/api/local-service'
import type { EntryRow } from '@/data/types'

const route = useRoute()
const router = useRouter()
const meta = moduleMeta('rainfall')

// 报表列与列表展示口径保持一致，另带复核信息，保证「列表与打印报表一致」。
const reportColumns = [
  '记录编号', '站点编号', '观测时段', '时段雨量', '日累计雨量', '降雨强度',
  '观测人', '记录状态', '复核结论', '复核人', '复核时间', '整编状态',
]

const rows = ref<EntryRow[]>([])
const filters = ref<Record<string, string>>({})
const statusFilter = ref('')
const printedAt = ref('')

const passCount = computed(() => rows.value.filter((row) => row.review?.verdict === '通过').length)
const abnormalCount = computed(
  () => rows.value.filter((row) => row.review?.verdict === '异常' || row.abnormal).length,
)
const pendingCompileCount = computed(
  () => rows.value.filter((row) => row.review?.verdict === '通过' && row.compiled !== true).length,
)

function formatCell(row: EntryRow, column: string): string {
  if (column === '复核结论') return row.review?.verdict ?? '未复核'
  if (column === '复核人') return row.review?.reviewer ?? '—'
  if (column === '复核时间') return row.review?.concludedAt ?? '—'
  if (column === '整编状态') {
    if (row.review?.verdict !== '通过') return '—'
    return row.compiled === true ? '已整编' : '待整编'
  }
  const value = row[column]
  return value === undefined || value === '' ? '—' : String(value)
}

function reload() {
  // 与列表完全相同的读取与筛选入口，避免两套口径。
  const query: Record<string, string> = {}
  const station = String(route.query.station ?? '')
  const period = String(route.query.period ?? '')
  statusFilter.value = String(route.query.status ?? '')
  if (station) {
    query['站点编号'] = station
    filters.value['站点编号'] = station
  }
  if (period) {
    query['观测时段'] = period
    filters.value['观测时段'] = period
  }
  const payload = listEntries(meta.key, query)
  rows.value = statusFilter.value
    ? payload.items.filter((row) => String(row.status) === statusFilter.value)
    : payload.items
  const date = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  printedAt.value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function doPrint() {
  window.print()
}

function doExport() {
  downloadEntries(meta.key)
}

function goBack() {
  router.push('/rainfall')
}

onMounted(reload)
</script>

<style scoped>
.report-sheet {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 24px 28px;
}
.sheet-head { text-align: center; margin-bottom: 12px; }
.sheet-title { margin: 0; font-size: 20px; }
.sheet-meta { color: var(--muted); font-size: 12px; margin: 6px 0 0; }
.report-table th, .report-table td { white-space: nowrap; }
.sheet-foot {
  display: flex; justify-content: space-between;
  margin-top: 12px; font-size: 12px; color: var(--muted);
}

@media print {
  .app-side, .app-head, .no-print { display: none !important; }
  .app-main { padding: 0; }
  .report-sheet { border: none; padding: 0; }
  .data-table th, .data-table td { border-color: #000; }
}
</style>
