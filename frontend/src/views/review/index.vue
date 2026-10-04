<template>
  <section v-if="meta && row" class="page review-page" :data-module="meta.key">
    <header class="page-head">
      <div>
        <h2>{{ meta.name }} · 复核详情</h2>
        <p class="page-desc">
          {{ meta.entity }}编号 {{ row.id }}：逐项核对观测要素后给出唯一复核结论，结论随记录持久化。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="goBack">返回列表</button>
      </div>
    </header>

    <article class="detail-card">
      <h3 class="detail-title">原始观测值（只读）</h3>
      <dl class="detail-grid">
        <template v-for="field in meta.fields" :key="field">
          <dt>{{ field }}</dt>
          <dd>{{ row[field] === undefined || row[field] === '' ? '—' : String(row[field]) }}</dd>
        </template>
        <dt>当前状态</dt>
        <dd>{{ row.status }}</dd>
      </dl>
    </article>

    <ReviewChecklist :items="meta.checklist ?? []" :checks="checks" :disabled="submitting" @update:checks="checks = $event" />

    <form class="conclusion-form" @submit.prevent="onSubmit">
      <h3 class="detail-title">复核结论</h3>
      <div v-if="existing" class="existing-conclusion" :class="existing.verdict === '通过' ? 'pass' : 'fail'">
        <span>已有结论：{{ existing.verdict }}</span>
        <span>复核人：{{ existing.reviewer }}</span>
        <span>时间：{{ existing.concludedAt }}</span>
        <span>第 {{ existing.revision }} 版</span>
        <span v-if="existing.remark">备注：{{ existing.remark }}</span>
      </div>
      <label class="form-item">
        <span>结论 *</span>
        <select v-model="verdict" :disabled="submitting">
          <option v-for="option in verdicts" :key="option" :value="option">{{ option }}</option>
        </select>
      </label>
      <label class="form-item">
        <span>复核人 *</span>
        <input v-model="reviewer" :disabled="submitting" placeholder="请输入复核人姓名" />
      </label>
      <label class="form-item full">
        <span>复核意见</span>
        <textarea v-model="remark" :disabled="submitting" rows="3" placeholder="异常项、处理建议等（选填）"></textarea>
      </label>
      <p v-if="existing" class="re-review-hint">重复复核只保留同一条结论：再次提交会更新为第 {{ existing.revision + 1 }} 版，不会新增。</p>
      <div class="form-actions">
        <button class="btn primary" type="submit" :disabled="submitting">
          {{ submitting ? '提交中…' : existing ? '更新复核结论' : '提交复核结论' }}
        </button>
        <button class="btn ghost" type="button" :disabled="submitting" @click="goBack">取消并返回</button>
        <span v-if="message" :class="ok ? 'success-text' : 'error-text'">{{ message }}</span>
      </div>
    </form>
  </section>

  <section v-else class="page">
    <p class="empty-state">没有找到该记录，可能已被重置。</p>
    <button class="btn" type="button" @click="goBack">返回列表</button>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import ReviewChecklist from '@/components/ReviewChecklist.vue'
import { getEntry, submitReview } from '@/api/review'
import { MODULE_BY_KEY } from '@/data/modules'
import type { ReviewVerdict } from '@/data/types'

const route = useRoute()
const router = useRouter()

const meta = computed(() => MODULE_BY_KEY.get(String(route.params.module ?? '')) ?? null)
const row = ref(getEntry(String(route.params.module ?? ''), Number(route.params.id)))
const checks = ref<Record<string, boolean>>({})
const verdict = ref<ReviewVerdict>('通过')
const reviewer = ref('')
const remark = ref('')
const submitting = ref(false)
const message = ref('')
const ok = ref(true)

const verdicts = computed<ReviewVerdict[]>(() => meta.value?.reviewVerdicts ?? ['通过', '异常'])
const existing = computed(() => row.value?.review ?? null)

// 路由 id 变化（同组件复用）时重新从持久化数据回显，保证拿到的是最新结论。
watch(
  () => route.fullPath,
  () => {
    row.value = getEntry(String(route.params.module ?? ''), Number(route.params.id))
    hydrate()
  },
)

function hydrate() {
  const current = existing.value
  if (current) {
    checks.value = { ...current.checks }
    verdict.value = current.verdict
    reviewer.value = current.reviewer
    remark.value = current.remark
  } else {
    checks.value = {}
    verdict.value = '通过'
    reviewer.value = ''
    remark.value = ''
  }
  message.value = ''
}

// 首次进入：结论、核对项全部从持久化数据回显，刷新或返回后原结论原样保留。
hydrate()

async function onSubmit() {
  if (!meta.value || !row.value || submitting.value) {
    return
  }
  submitting.value = true
  message.value = ''
  try {
    const result = await submitReview(meta.value.key, Number(row.value.id), {
      checks: checks.value,
      verdict: verdict.value,
      reviewer: reviewer.value,
      remark: remark.value,
    })
    ok.value = result.ok
    message.value = result.message
    if (result.ok) {
      row.value = getEntry(meta.value.key, Number(row.value.id))
      hydrate()
    }
  } finally {
    submitting.value = false
  }
}

function goBack() {
  router.push(`/${meta.value?.key ?? ''}`)
}
</script>

<style scoped>
.detail-card {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 16px;
}
.detail-title { font-size: 14px; margin: 4px 0 8px; }
.detail-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px 16px;
  margin: 0;
}
.detail-grid dt { font-size: 12px; color: var(--muted); }
.detail-grid dd { margin: 0 0 4px; font-size: 13px; }
.conclusion-form {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 16px;
  margin-top: 12px;
}
.form-item { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); margin-bottom: 8px; }
.form-item.full { grid-column: 1 / -1; }
.form-item input, .form-item select, .form-item textarea {
  font-size: 13px; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px;
}
.existing-conclusion {
  display: flex; flex-wrap: wrap; gap: 6px 16px;
  background: #f0fdf4; border: 1px solid #abefc6; border-radius: 6px;
  padding: 8px 12px; font-size: 13px; margin-bottom: 10px;
}
.existing-conclusion.fail { background: #fef3f2; border-color: #fda29b; }
.re-review-hint { font-size: 12px; color: var(--muted); margin: 4px 0 8px; }
.form-actions { display: flex; gap: 10px; align-items: center; }
.success-text { color: #067647; font-size: 13px; }
</style>
