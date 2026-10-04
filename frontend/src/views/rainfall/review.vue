<template>
  <section v-if="row" class="page review-page" data-module="rainfall">
    <header class="page-head">
      <div>
        <h2>雨量记录 · 复核详情</h2>
        <p class="page-desc">
          记录编号 {{ row['记录编号'] }}：核对观测时段、时段雨量与日累计雨量，结论随记录保存，刷新与返回后仍在。
        </p>
      </div>
      <div class="page-actions">
        <button class="btn" type="button" @click="goBack">返回列表</button>
      </div>
    </header>

    <article class="detail-card">
      <h3 class="detail-title">原始观测值（只读，不随复核改动）</h3>
      <dl class="detail-grid">
        <template v-for="field in meta.fields" :key="field">
          <dt>{{ field }}</dt>
          <dd>{{ row[field] === undefined || row[field] === '' ? '—' : String(row[field]) }}</dd>
        </template>
        <dt>当前状态</dt>
        <dd>{{ row.status }}</dd>
      </dl>
    </article>

    <article class="detail-card" v-if="daily">
      <h3 class="detail-title">
        日累计核对（{{ daily.stationNo }} · {{ daily.day }}）
      </h3>
      <table class="data-table inner-table">
        <thead>
          <tr><th>观测时段</th><th>时段雨量(mm)</th></tr>
        </thead>
        <tbody>
          <tr v-for="part in daily.parts" :key="part.id">
            <td>{{ part.period }}</td>
            <td>{{ part.amount === null ? '原始值无法解析' : part.amount }}</td>
          </tr>
        </tbody>
      </table>
      <p
        class="daily-result"
        :class="daily.consistent === true ? 'ok' : daily.consistent === false ? 'bad' : 'unknown'"
      >
        当日各时段合计：<strong>{{ daily.sumPeriod === null ? '—' : daily.sumPeriod }}</strong> mm，
        日累计雨量：<strong>{{ daily.dailyRain === null ? '—' : daily.dailyRain }}</strong> mm，
        <template v-if="daily.consistent === true">两者一致，可以通过。</template>
        <template v-else-if="daily.consistent === false">两者不一致，请在清单中标注并按异常处理。</template>
        <template v-else>存在无法解析的原始值，请人工核对原始记载。</template>
      </p>
    </article>

    <ReviewChecklist :items="meta.checklist ?? []" :checks="checks" :disabled="submitting" @update:checks="checks = $event" />

    <form class="conclusion-form" @submit.prevent="onSubmit">
      <h3 class="detail-title">复核结论（同一记录只保留一条）</h3>
      <div v-if="existing" class="existing-conclusion" :class="existing.verdict === '通过' ? 'pass' : 'fail'">
        <span>已有结论：{{ existing.verdict }}</span>
        <span>复核人：{{ existing.reviewer }}</span>
        <span>时间：{{ existing.concludedAt }}</span>
        <span>第 {{ existing.revision }} 版</span>
        <span v-if="existing.remark">备注：{{ existing.remark }}</span>
      </div>
      <div class="form-row">
        <label class="form-item">
          <span>结论 *</span>
          <select v-model="verdict" :disabled="submitting">
            <option value="通过">通过</option>
            <option value="异常">异常</option>
          </select>
        </label>
        <label class="form-item">
          <span>复核人 *</span>
          <input v-model="reviewer" :disabled="submitting" placeholder="请输入复核人姓名" />
        </label>
      </div>
      <label class="form-item full">
        <span>复核意见</span>
        <textarea v-model="remark" :disabled="submitting" rows="3" placeholder="异常项、处理建议等（选填）"></textarea>
      </label>
      <p v-if="existing" class="re-review-hint">
        重复复核不会新增结论：再次提交将覆盖为第 {{ existing.revision + 1 }} 版；内容完全相同则幂等不重复落库。
      </p>
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
    <p class="empty-state">没有找到该雨量记录，可能已被重置。</p>
    <button class="btn" type="button" @click="goBack">返回雨量列表</button>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import ReviewChecklist from '@/components/ReviewChecklist.vue'
import { checkDailyRain, getEntry, submitReview } from '@/api/review'
import { moduleMeta } from '@/api/local-service'
import type { EntryRow, DailyRainCheck, ReviewVerdict } from '@/data/types'

const route = useRoute()
const router = useRouter()
const meta = moduleMeta('rainfall')

const row = ref(getEntry('rainfall', Number(route.params.id)))
const daily = ref<DailyRainCheck | null>(row.value ? checkDailyRain(row.value) : null)
const checks = ref<Record<string, boolean>>({})
const verdict = ref<ReviewVerdict>('通过')
const reviewer = ref('')
const remark = ref('')
const submitting = ref(false)
const message = ref('')
const ok = ref(true)

const existing = computed(() => row.value?.review ?? null)

watch(
  () => Number(route.params.id),
  (id) => {
    row.value = getEntry('rainfall', id)
    daily.value = row.value ? checkDailyRain(row.value) : null
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

// 刷新 / 重新进入：从持久化数据回显原结论。
hydrate()

async function onSubmit() {
  if (!row.value || submitting.value) {
    return
  }
  submitting.value = true
  message.value = ''
  try {
    const result = await submitReview('rainfall', Number(row.value.id), {
      checks: checks.value,
      verdict: verdict.value,
      reviewer: reviewer.value,
      remark: remark.value,
    })
    ok.value = result.ok
    message.value = result.message
    if (result.ok) {
      const refreshed = getEntry('rainfall', Number(row.value.id))
      row.value = refreshed
      if (refreshed) {
        daily.value = checkDailyRain(refreshed)
      }
      hydrate()
    }
  } finally {
    submitting.value = false
  }
}

function goBack() {
  router.push('/rainfall')
}
</script>

<style scoped>
.detail-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; margin-bottom: 12px; }
.detail-title { font-size: 14px; margin: 4px 0 8px; }
.detail-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 6px 16px; margin: 0; }
.detail-grid dt { font-size: 12px; color: var(--muted); }
.detail-grid dd { margin: 0 0 4px; font-size: 13px; }
.inner-table { margin: 6px 0; }
.daily-result { font-size: 13px; margin: 8px 0 0; }
.daily-result.ok { color: #067647; }
.daily-result.bad { color: #b42318; }
.daily-result.unknown { color: var(--muted); }
.conclusion-form { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 12px 16px; }
.form-row { display: flex; gap: 16px; }
.form-item { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--muted); margin-bottom: 8px; flex: 1; }
.form-item.full { width: 100%; }
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
