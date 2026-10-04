<template>
  <section class="page" data-module="compilation">
    <header class="page-head">
      <div>
        <h2>数据整编管理</h2>
        <p class="page-desc">整编待办直接取自已复核通过的雨量记录；核对通过后编入成果，列表与打印报表保持一致。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记整编成果</button>
        <button class="btn" type="button" @click="exportRows">导出数据整编清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <section class="todo-card">
      <header class="todo-head">
        <h3>整编待办（复核通过、尚未编入成果的雨量记录）</h3>
        <button class="btn" type="button" @click="reload">刷新待办</button>
      </header>
      <table class="data-table">
        <thead>
          <tr>
            <th>记录编号</th><th>站点编号</th><th>观测时段</th><th>时段雨量</th>
            <th>日累计雨量</th><th>复核人</th><th>复核时间</th><th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in todos" :key="item.id">
            <td>{{ item.recordNo }}</td>
            <td>{{ item.stationNo }}</td>
            <td>{{ item.period }}</td>
            <td>{{ item.periodRain ?? '—' }}</td>
            <td>{{ item.dailyRain ?? '—' }}</td>
            <td>{{ item.reviewer }}</td>
            <td>{{ item.concludedAt }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="openCheck(item.id)">核对整编</button>
              <button class="link" type="button" @click="compileOne(item.id)">直接编入</button>
            </td>
          </tr>
          <tr v-if="!todos.length">
            <td colspan="8" class="empty-state">没有待整编记录：通过雨量复核的记录会自动进入这里</td>
          </tr>
        </tbody>
      </table>
    </section>

    <ReviewChecklist
      v-if="activeTodo"
      :items="meta.checklist ?? []"
      :checks="compileChecks"
      @update:checks="compileChecks = $event"
    />
    <div v-if="activeTodo" class="check-actions">
      <button class="btn primary" type="button" :disabled="compileChecksDone < (meta.checklist?.length ?? 0)" @click="confirmCompile">
        核对无误，编入整编成果（{{ compileChecksDone }}/{{ meta.checklist?.length ?? 0 }}）
      </button>
      <button class="btn ghost" type="button" @click="activeTodo = null">收起核对</button>
      <span v-if="compileMessage" :class="compileOk ? 'success-text' : 'error-text'">{{ compileMessage }}</span>
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
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
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
      <span>共 {{ total }} 条整编成果记录，待办 {{ todos.length }} 条与雨量复核数据实时一致</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import ReviewChecklist from '@/components/ReviewChecklist.vue'
import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { markCompiled, pendingCompilationTodos } from '@/api/review'
import type { ActionResult, CompilationTodo, EntryRow } from '@/data/types'

const meta = moduleMeta('compilation')
const columns = ['成果编号', '整编年份', '站点编号', '整编类型', '原始记录数', '整编人', '审核人', '整编状态']
const actions = ['开始整编', '提交审核', '驳回整编']
const statuses = ['待整编', '整编中', '待审核', '已刊印', '已驳回']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const todos = ref<CompilationTodo[]>([])
const activeTodo = ref<CompilationTodo | null>(null)
const compileChecks = ref<Record<string, boolean>>({})
const compileMessage = ref('')
const compileOk = ref(true)

const compileChecksDone = computed(
  () => (meta.checklist ?? []).filter((_, index) => Boolean(compileChecks.value[`check${index}`])).length,
)

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '待整编雨量记录', value: todos.value.length },
  { label: '整编中年度', value: rows.value.filter((row) => String(row.status) === '整编中').length },
  { label: '已刊印成果', value: rows.value.filter((row) => String(row.status) === '已刊印').length },
])

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '整编成果登记入口尚未接入审批流'
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

function openCheck(id: number) {
  activeTodo.value = todos.value.find((item) => item.id === id) ?? null
  compileChecks.value = {}
  compileMessage.value = ''
}

function compileOne(id: number): void {
  const result = markCompiled(id)
  errorMessage.value = result.ok ? '' : result.message
  if (result.ok) {
    activeTodo.value = null
  }
  reload()
}

function confirmCompile() {
  if (!activeTodo.value || compileChecksDone.value < (meta.checklist?.length ?? 0)) {
    return
  }
  const result: ActionResult = markCompiled(activeTodo.value.id)
  compileOk.value = result.ok
  compileMessage.value = result.message
  if (result.ok) {
    activeTodo.value = null
    compileChecks.value = {}
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    // 待办与雨量列表 / 打印报表同一份数据源，复核一通过这里立即出现、整编后立即消失。
    todos.value = pendingCompilationTodos()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '数据整编列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.todo-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; }
.todo-head { display: flex; justify-content: space-between; align-items: center; }
.todo-head h3 { font-size: 14px; margin: 0; }
.check-actions { display: flex; gap: 10px; align-items: center; margin: 0 0 12px; }
.success-text { color: #067647; font-size: 13px; }
</style>
