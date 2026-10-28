<script setup lang="ts">
const props = defineProps<{ status: string }>()

const GOOD = 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400'
const WAIT = 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
const BAD = 'bg-destructive/10 text-destructive'
const INFO = 'bg-sky-500/10 text-sky-700 dark:text-sky-400'
const STYLES: Record<string, string> = {
  COMPLETED: GOOD, ACTIVE: GOOD, POSTED: GOOD,
  PENDING: WAIT, PENDING_KYC: WAIT, PROCESSING: WAIT, PLANNED: '',
  FAILED: BAD, REJECTED: BAD, CLOSED: BAD,
  REVERSED: INFO, FROZEN: INFO, SUSPENDED: INFO,
}
</script>

<template>
  <Badge variant="secondary" :class="STYLES[props.status]">
    {{ humanize(props.status) }}
  </Badge>
</template>
