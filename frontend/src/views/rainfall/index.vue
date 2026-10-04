<template>
  <section class="page" data-module="rainfall">
    <header class="page-head">
      <div>
        <h2>雨量观测管理</h2>
        <p class="page-desc">维护雨量记录，围绕记录编号、站点编号、观测时段、时段雨量做登记、筛选与复核流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="openReport">打印复核报表</button>
        <button class="btn" type="button" @click="exportRows">导出雨量观测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <label class="filter-item">
        <span>记录状态</span>
        <select v-model="statusFilter">
          <option value="">全部</option>
          <option v-for="status in statuses" :key="status" :value="status">{{ status }}</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>复核结论</th>
          <th>复核人</th>
          <th>整编状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.review?.verdict ?? '未复核' }}</td>
          <td>{{ row.review?.reviewer ?? '—' }}</td>
          <td>{{ row.review?.verdict === '通过' ? (row.compiled ? '已整编' : '待整编') : '—' }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openReview(row)">
              {{ row.review ? '查看复核' : '复核' }}
            </button>
            <button class="link" type="button" @click="runAction('提交审核', row)">提交审核</button>
            <button class="link" type="button" @click="runAction('标记异常', row)">标记异常</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 4" class="empty-state">暂无雨量观测数据</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条雨量观测记录，结论与整编状态随记录持久化，刷新后仍保留</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import { downloadEntries, listEntries, moduleMeta, runAction as applyAction } from '@/api/local-service'
import { parseAmount } from '@/api/review'
import type { EntryRow } from '@/data/types'

const router = useRouter()
const meta = moduleMeta('rainfall')
const columns = ['记录编号', '站点编号', '观测时段', '时段雨量', '日累计雨量', '降雨强度', '观测人', '记录状态']
const statuses = ['已采集', '待审核', '已通过', '异常值']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const statusFilter = ref('')
const filterFields = ['记录编号', '站点编号', '观测时段']

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 指标与整编待办同源实时统计，不再是写死的 0。
const stats = computed(() => {
  const today = new Date().toISOString().slice(0, 10)
  const observedToday = rows.value.filter((row) => String(row['观测时段'] ?? '').startsWith(today)).length
  const stormCount = rows.value.filter((row) => {
    const amount = parseAmount(row['时段雨量'])
    return amount !== null && amount >= 50
  }).length
  const pendingReview = rows.value.filter((row) => String(row.status) === '待审核').length
  return [
    { label: '今日观测站次', value: observedToday },
    { label: '暴雨站点数', value: stormCount },
    { label: '待审核记录', value: pendingReview },
  ]
})

function resetFilters() {
  filters.value = {}
  statusFilter.value = ''
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openReport() {
  const query: Record<string, string> = {}
  if (filters.value['站点编号']) query.station = filters.value['站点编号']
  if (filters.value['观测时段']) query.period = filters.value['观测时段']
  if (statusFilter.value) query.status = statusFilter.value
  router.push({ path: '/rainfall/report', query })
}

function openReview(row: EntryRow) {
  router.push(`/rainfall/${Number(row.id)}/review`)
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = statusFilter.value
      ? payload.items.filter((row) => String(row.status) === statusFilter.value)
      : payload.items
    total.value = rows.value.length
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '雨量观测列表读取失败'
  }
}

onMounted(reload)
</script>
