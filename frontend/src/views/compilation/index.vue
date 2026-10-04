<template>
  <section class="page" data-module="compilation">
    <header class="page-head">
      <div>
        <h2>数据整编管理</h2>
        <p class="page-desc">维护整编成果，围绕成果编号、整编年份、站点编号、整编类型做登记、筛选与状态流转；整编待办与各观测模块的复核结论同源。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记整编成果</button>
        <button class="btn" type="button" @click="printTodos">打印整编待办报表</button>
        <button class="btn" type="button" @click="exportRows">导出数据整编清单</button>
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

    <div class="detail-card todo-card">
      <h3>整编待办</h3>
      <p class="card-tip">待办数直接取各观测模块 pending 记录（待审核/已采集等未到终态），与列表状态、运营概览完全一致。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>来源模块</th>
            <th>待办（待复核/未终态）</th>
            <th>已复核结论</th>
            <th>异常值</th>
            <th>记录总数</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="todo in todos" :key="todo.module.key">
            <td>{{ todo.module.name }}</td>
            <td>{{ todo.pending }}</td>
            <td>{{ todo.reviewed }}</td>
            <td>{{ todo.abnormal }}</td>
            <td>{{ todo.total }}</td>
          </tr>
          <tr v-if="!todos.length">
            <td colspan="5" class="empty-state">暂无整编来源模块</td>
          </tr>
        </tbody>
      </table>
    </div>

    <div class="detail-card checklist-card">
      <h3>整编核对清单</h3>
      <ul class="check-list">
        <li v-for="item in compilationChecklist" :key="item.id">
          <label>
            <input v-model="checks" type="checkbox" :value="item.id" />
            <span :class="{ checked: checks.includes(item.id) }">{{ item.label }}</span>
          </label>
        </li>
      </ul>
    </div>

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
              v-for="action in actions"
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
          <td :colspan="columns.length + 2" class="empty-state">暂无数据整编数据，可先登记整编成果</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条数据整编记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  displayColumns,
  displayValue,
  downloadEntries,
  filterRows,
  listEntries,
  loadCompilationTodos,
  moduleMeta,
  printReport,
  runAction as applyAction,
} from '@/views/shared'
import type { CompilationTodoItem } from '@/views/shared'
import { listRows } from '@/data/local-store'

const meta = moduleMeta('compilation')
const columns = displayColumns(meta)
const actions = ["开始整编", "提交审核", "驳回整编"]
const filterFields = columns.slice(0, 3)

const rows = ref(listEntries(meta.key).items)
const total = ref(rows.value.length)
const todos = ref<CompilationTodoItem[]>([])
const checks = ref<string[]>([])
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})

// 整编核对清单：刊印/提交前逐项核对，待办数直接引用上面待办表，避免与实际对不上。
const compilationChecklist = computed(() => {
  const pendingTotal = todos.value.reduce((sum, item) => sum + item.pending, 0)
  const abnormalTotal = todos.value.reduce((sum, item) => sum + item.abnormal, 0)
  return [
    { id: 'todo', label: `整编待办已清零（当前待办 ${pendingTotal} 条，须为 0 方可刊印）` },
    { id: 'abnormal', label: `异常值记录均已处置或标注说明（当前异常 ${abnormalTotal} 条）` },
    { id: 'review', label: '纳入整编的观测记录均已留有复核结论（结论、复核人、意见齐全）' },
    { id: 'consistency', label: '整编成果与复核后观测值一致，列表数据与打印报表逐项核对相符' },
  ]
})

const statusSummary = computed(() =>
  meta.statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => {
  const all = listRows(meta.key)
  return [
    { label: '待整编年度', value: all.filter((row) => row.pending).length },
    { label: '整编中年度', value: all.filter((row) => String(row.status) === '整编中').length },
    { label: '已刊印成果', value: all.filter((row) => String(row.status) === '已刊印').length },
  ]
})

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key, filters.value)
}

function printTodos() {
  errorMessage.value = ''
  const ok = printReport('数据整编待办报表', [
    {
      heading: '整编待办汇总',
      columns: ['来源模块', '待办（待复核/未终态）', '已复核结论', '异常值', '记录总数'],
      rows: todos.value.map((item) => [
        item.module.name,
        String(item.pending),
        String(item.reviewed),
        String(item.abnormal),
        String(item.total),
      ]),
    },
    {
      heading: '整编成果清单',
      columns,
      rows: filterRows(listRows(meta.key), filters.value)
        .map((row) => columns.map((column) => displayValue(row, column))),
    },
  ])
  if (!ok) {
    errorMessage.value = '浏览器拦截了打印窗口，请允许弹出窗口后重试'
  }
}

function openCreate() {
  errorMessage.value = '整编成果登记入口尚未接入审批流'
}

function runAction(action: string, row: { id: number | string }) {
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
    todos.value = loadCompilationTodos()
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '数据整编列表读取失败'
  }
}

onMounted(reload)
</script>
