<template>
  <ReviewTablePage :module-key="MODULE_KEY" />
</template>

<script setup lang="ts">
import ReviewTablePage from '@/views/shared/ReviewTablePage.vue'

const MODULE_KEY = 'evaporation'
</script>
