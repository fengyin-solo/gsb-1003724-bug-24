<template>
  <section class="page" :data-module="meta.key">
    <header class="page-head">
      <div>
        <h2>{{ meta.name }}管理</h2>
        <p class="page-desc">{{ meta.desc }}</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记{{ meta.entity }}</button>
        <button class="btn" type="button" @click="printRows">打印{{ meta.name }}报表</button>
        <button class="btn" type="button" @click="exportRows">导出{{ meta.name }}清单</button>
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
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ displayValue(row, column) || '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-if="meta.reviewable"
              class="link"
              type="button"
              @click="openReview(row)"
            >
              {{ row.review ? '查看复核' : '复核' }}
            </button>
            <button
              v-for="action in meta.actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无{{ meta.name }}数据，可先登记{{ meta.entity }}</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条{{ meta.name }}记录（打印/导出按当前筛选条件）</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRouter } from 'vue-router'

import {
  displayColumns,
  displayValue,
  downloadEntries,
  filterRows,
  listEntries,
  moduleMeta,
  printReport,
  runAction as applyAction,
} from '@/views/shared'
import type { EntryRow } from '@/data/types'
import { listRows } from '@/data/local-store'

const props = defineProps<{ moduleKey: string }>()

const router = useRouter()
const meta = moduleMeta(props.moduleKey)
const columns = displayColumns(meta)
const filterFields = columns.slice(0, 3)

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

const statusSummary = computed(() =>
  meta.statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

// 指标卡口径与看板同源：总量看登记数，待办看 pending，异常看 abnormal。
const stats = computed(() =>
  meta.metrics.map((label) => {
    const all = listRows(meta.key)
    let value = 0
    if (label.includes('待') || label.includes('中')) {
      value = all.filter((row) => row.pending).length
    } else if (label.includes('异常') || label.includes('超标') || label.includes('故障')
      || label.includes('超警戒') || label.includes('暴雨')) {
      value = all.filter((row) => row.abnormal).length
    } else {
      value = all.length
    }
    return { label, value }
  }),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key, filters.value)
}

// 打印报表与当前列表严格一致：同样的筛选、同样的列、同样的取值函数。
function printRows() {
  errorMessage.value = ''
  const printRowsData = filterRows(listRows(meta.key), filters.value)
  const ok = printReport(`${meta.name}清单`, [{
    columns,
    rows: printRowsData.map((row) => columns.map((column) => displayValue(row, column))),
  }])
  if (!ok) {
    errorMessage.value = '浏览器拦截了打印窗口，请允许弹出窗口后重试'
  }
}

function openCreate() {
  errorMessage.value = `${meta.entity}登记入口尚未接入审批流`
}

function openReview(row: EntryRow) {
  void router.push({ name: 'review-detail', params: { moduleKey: meta.key, id: String(row.id) } })
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  if (!result.duplicated) {
    errorMessage.value = result.message
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : `${meta.name}列表读取失败`
  }
}

// 进入页面即读取：从复核详情返回会重新挂载，刚落的结论立即回显；刷新同样走这里。
onMounted(reload)
</script>
