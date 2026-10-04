<template>
  <section class="page review-detail" :data-module="meta.key">
    <header class="page-head">
      <div>
        <h2>{{ meta.name }} · 复核详情</h2>
        <p class="page-desc">
          记录编号 {{ entryId }} · 当前状态「{{ row?.status ?? '—' }}」
          <template v-if="row?.review"> · 已于 {{ formatTime(row.review.reviewedAt) }} 由 {{ row.review.reviewer }} 复核</template>
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="goBack">返回列表</button>
        <button class="btn" type="button" @click="printDetail">打印复核单</button>
      </div>
    </header>

    <div v-if="!row" class="detail-card">
      <p class="error-text">没有找到该条{{ meta.entity }}，可能已被重置，请返回列表重新选择。</p>
    </div>

    <template v-else>
      <div class="detail-card">
        <h3>原始观测值</h3>
        <p class="card-tip">以下为采集记载，复核不改动原始观测值。</p>
        <dl class="field-grid">
          <div v-for="field in meta.fields" :key="field" v-show="!field.endsWith('状态')">
            <dt>{{ field }}</dt>
            <dd :class="{ 'focus-value': focusFields.has(field) }">
              {{ row[field] === undefined || row[field] === '' ? '—' : row[field] }}
            </dd>
          </div>
        </dl>
      </div>

      <div class="detail-card">
        <h3>核对清单</h3>
        <ul class="check-list">
          <li v-for="item in meta.checklist" :key="item.id">
            <label>
              <input
                v-model="checked"
                type="checkbox"
                :value="item.id"
                :disabled="readonly"
              />
              <span :class="{ checked: isChecked(item.id) }">{{ item.label }}</span>
            </label>
          </li>
        </ul>
      </div>

      <div class="detail-card">
        <h3>复核结论</h3>
        <div v-if="readonly" class="readonly-review">
          <p><strong>结论：</strong>{{ row.review?.conclusion }}</p>
          <p><strong>复核人：</strong>{{ row.review?.reviewer }}</p>
          <p><strong>复核时间：</strong>{{ formatTime(row.review?.reviewedAt) }}</p>
          <p><strong>复核意见：</strong>{{ row.review?.comment || '—' }}</p>
          <p class="card-tip">
            结论已落库并随列表、打印报表、整编待办同步；刷新页面或重新进入都会保留。
            如需更改，请先在列表对该记录执行「提交审核」发起重新复核。
          </p>
        </div>
        <form v-else class="review-form" @submit.prevent="submit">
          <fieldset>
            <legend>结论</legend>
            <label v-for="option in meta.reviewConclusions" :key="option" class="conclusion-option">
              <input v-model="form.conclusion" type="radio" name="conclusion" :value="option" />
              <span>{{ option }}</span>
            </label>
          </fieldset>
          <label class="form-item">
            <span>复核人</span>
            <input v-model="form.reviewer" type="text" placeholder="填写复核人姓名" />
          </label>
          <label class="form-item">
            <span>复核意见{{ abnormalRequired ? '（异常结论必填）' : ''}}</span>
            <textarea v-model="form.comment" rows="3" placeholder="填写复核意见；异常结论须说明情况与处理建议"></textarea>
          </label>
          <div class="form-actions">
            <button class="btn primary" type="submit" :disabled="submitting">
              {{ submitting ? '提交中…' : '提交复核' }}
            </button>
            <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
          </div>
        </form>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import {
  displayValue,
  getEntry,
  moduleMeta,
  printReport,
  submitReview,
} from '@/views/shared'
import type { EntryRow } from '@/data/types'

const route = useRoute()
const router = useRouter()

const moduleKey = String(route.params.moduleKey)
const entryId = Number(route.params.id)
const meta = moduleMeta(moduleKey)
const focusFields = new Set(meta.reviewFocusFields ?? [])

const row = ref<EntryRow | undefined>(undefined)
const submitting = ref(false)
const errorMessage = ref('')
const checked = ref<string[]>([])
const form = reactive({ conclusion: '', reviewer: '', comment: '' })

const readonly = computed(() => Boolean(row.value?.review))
const abnormalRequired = computed(() =>
  (meta.abnormalConclusions ?? []).includes(form.conclusion))

function isChecked(id: string): boolean {
  return checked.value.includes(id)
}

function formatTime(iso?: string): string {
  if (!iso) {
    return '—'
  }
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) {
    return iso
  }
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function hydrate() {
  row.value = getEntry(moduleKey, entryId)
  if (row.value?.review) {
    checked.value = [...row.value.review.checked]
    form.conclusion = row.value.review.conclusion
    form.reviewer = row.value.review.reviewer
    form.comment = row.value.review.comment
  } else {
    checked.value = []
    form.conclusion = ''
    form.reviewer = ''
    form.comment = ''
  }
  errorMessage.value = ''
}

function submit() {
  errorMessage.value = ''
  submitting.value = true
  try {
    const result = submitReview(moduleKey, entryId, {
      conclusion: form.conclusion,
      reviewer: form.reviewer,
      comment: form.comment,
      checked: checked.value,
    })
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    hydrate()
  } finally {
    submitting.value = false
  }
}

function goBack() {
  // 从列表点进来的优先用浏览器后退；直接打开详情（刷新/分享链接）则回模块列表。
  if (window.history.state?.back) {
    router.back()
  } else {
    void router.push({ name: moduleKey })
  }
}

function printDetail() {
  if (!row.value) {
    return
  }
  errorMessage.value = ''
  const baseColumns = meta.fields.filter((field) => !field.endsWith('状态'))
  const checklistRows = (meta.checklist ?? []).map((item) => [
    isChecked(item.id) ? '√' : '—',
    item.label,
  ])
  const reviewRows = row.value.review
    ? [
        ['复核结论', displayValue(row.value, '复核结论')],
        ['复核人', displayValue(row.value, '复核人')],
        ['复核时间', displayValue(row.value, '复核时间')],
        ['复核意见', row.value.review.comment || '—'],
      ]
    : [['复核结论', '尚未复核']]
  const ok = printReport(`${meta.name}复核单 · ${entryId}`, [
    {
      heading: '原始观测值',
      columns: baseColumns,
      rows: [baseColumns.map((column) => displayValue(row.value as EntryRow, column))],
    },
    { heading: '核对清单', columns: ['核对结果', '核对项'], rows: checklistRows },
    { heading: '复核结论', columns: ['项目', '内容'], rows: reviewRows },
  ])
  if (!ok) {
    errorMessage.value = '浏览器拦截了打印窗口，请允许弹出窗口后重试'
  }
}

onMounted(hydrate)
</script>
