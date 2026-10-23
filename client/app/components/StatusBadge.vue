<script setup lang="ts">
const props = defineProps<{ status: TransferStatus | Customer['status'] | Account['status'] | Customer['kycStatus'] }>()

const STYLES: Record<string, string> = {
  posted: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  active: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  verified: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400',
  pending: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
  failed: 'bg-destructive/10 text-destructive',
  rejected: 'bg-destructive/10 text-destructive',
  frozen: 'bg-sky-500/10 text-sky-700 dark:text-sky-400',
  suspended: 'bg-amber-500/10 text-amber-700 dark:text-amber-400',
}
</script>

<template>
  <Badge variant="secondary" :class="STYLES[props.status]" class="capitalize">
    {{ props.status }}
  </Badge>
</template>
