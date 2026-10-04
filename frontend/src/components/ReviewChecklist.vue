<template>
  <fieldset class="checklist" :class="{ readonly: disabled }">
    <legend class="checklist-title">
      核对清单
      <span class="checklist-progress">{{ checkedCount }}/{{ items.length }}</span>
    </legend>
    <label v-for="(item, index) in items" :key="`${index}-${item}`" class="checklist-item">
      <input
        type="checkbox"
        :checked="Boolean(checks[`check${index}`])"
        :disabled="disabled"
        @change="toggle(index, ($event.target as HTMLInputElement).checked)"
      />
      <span>{{ index + 1 }}. {{ item }}</span>
    </label>
    <p v-if="!disabled && checkedCount < items.length" class="checklist-hint">
      还有 {{ items.length - checkedCount }} 项未核对，全部勾选后才能提交结论
    </p>
  </fieldset>
</template>

<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  items: string[]
  checks: Record<string, boolean>
  disabled?: boolean
}>()

const emit = defineEmits<{
  (event: 'update:checks', value: Record<string, boolean>): void
}>()

const checkedCount = computed(
  () => props.items.filter((_, index) => Boolean(props.checks[`check${index}`])).length,
)

function toggle(index: number, checked: boolean) {
  emit('update:checks', { ...props.checks, [`check${index}`]: checked })
}
</script>

<style scoped>
.checklist {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px 16px;
  margin: 12px 0;
  background: #fbfdff;
}
.checklist-title {
  font-weight: 600;
  font-size: 14px;
  padding: 0 6px;
}
.checklist-progress {
  color: var(--muted);
  font-weight: 400;
  font-size: 12px;
  margin-left: 6px;
}
.checklist-item {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 13px;
  padding: 4px 0;
  cursor: pointer;
}
.checklist.readonly .checklist-item {
  cursor: default;
}
.checklist-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #b54708;
}
</style>
