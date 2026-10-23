<script setup lang="ts">
import { Wallet } from 'lucide-vue-next'

defineProps<{ balance?: Balance, account?: Account, loading?: boolean }>()
</script>

<template>
  <Card>
    <CardHeader>
      <CardDescription class="flex items-center gap-2">
        <Wallet class="size-4" />
        {{ account?.currency ?? balance?.currency }} account
      </CardDescription>
      <CardTitle class="text-3xl tabular-nums">
        <Skeleton v-if="loading" class="h-9 w-40" />
        <template v-else-if="balance">
          {{ formatMoney(balance.balance, balance.currency) }}
        </template>
        <span v-else class="text-muted-foreground">—</span>
      </CardTitle>
      <CardAction v-if="account">
        <StatusBadge :status="account.status" />
      </CardAction>
    </CardHeader>
    <CardContent class="space-y-1 text-xs text-muted-foreground">
      <p>Asset <span class="font-mono">{{ account?.asset ?? balance?.asset }}</span></p>
      <p class="truncate">
        Ledger <span class="font-mono">{{ account?.ledgerAddress ?? balance?.ledgerAddress }}</span>
      </p>
    </CardContent>
  </Card>
</template>
