<script setup lang="ts">
import { ArrowLeft, ArrowRight, ExternalLink } from 'lucide-vue-next'

const route = useRoute()
const id = route.params.id as string
const config = useRuntimeConfig()

const { data: order, error } = await useFetch<PaymentOrderDetail>(`/api/payments/${id}`)
if (error.value) throw createError({ statusCode: error.value.statusCode ?? 500, statusMessage: error.value.statusMessage, fatal: true })

const { data: ledger, status: ledgerLoad } = useLazyFetch<LedgerTx[]>(`/api/payments/${id}/ledger`, { default: () => [] })

// Name every stock the order touches (payer, payee, movement ends).
const stockIds = computed(() => {
  const o = order.value
  if (!o) return ''
  return [...new Set([o.payerAccountId, o.payeeAccountId, ...o.movements.flatMap(m => [m.fromStockId, m.toStockId])])].join(',')
})
const { data: stockViews } = useLazyFetch<StockView[]>('/api/stocks', { query: computed(() => ({ ids: stockIds.value })), default: () => [] })
const stockById = computed(() => new Map(stockViews.value.map(s => [s.id, s])))
const stockLabel = (stockId: string | null) => {
  if (!stockId) return 'hold'
  const s = stockById.value.get(stockId)
  return s ? `${s.profile.fullName} · ${s.account.name ?? PRODUCT_LABELS[s.account.productType]}` : shortId(stockId)
}
const stockProfile = (stockId: string) => stockById.value.get(stockId)?.profile.id

const temporalUrl = computed(() => `${config.public.temporalUiUrl}/namespaces/default/workflows/${encodeURIComponent(order.value?.workflowId ?? '')}`)
const STEP_HELP: Record<LedgerStep, string> = {
  RESERVE: 'Customer money moved to per-order hold accounts',
  SETTLE: 'The balance movements, paid from the holds',
  REVERT: 'Compensation: SETTLE reversed (a POST_PAYMENT SPI failed)',
  RELEASE: 'Compensation: holds returned to the customers',
}
</script>

<template>
  <div v-if="order" class="space-y-6">
    <NuxtLink
      :to="stockProfile(order.payerAccountId) ? `/profiles/${stockProfile(order.payerAccountId)}` : '/'"
      class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft class="size-4" /> Back to payer
    </NuxtLink>

    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p class="text-sm text-muted-foreground">
          {{ order.serviceName }} · {{ humanize(order.commandType) }} · <span class="font-mono">{{ order.orderReference }}</span>
        </p>
        <h1 class="text-3xl font-semibold tabular-nums">
          {{ formatMoney(order.amount, order.currency) }}
        </h1>
        <p class="text-sm text-muted-foreground">
          {{ order.payerName }} → {{ order.payeeName ?? '—' }}
        </p>
      </div>
      <div class="flex flex-col items-end gap-2">
        <StatusBadge :status="order.status" />
        <p v-if="order.statusReasonCode" class="text-sm text-muted-foreground">
          {{ humanize(order.statusReasonCode) }}
        </p>
        <a :href="temporalUrl" target="_blank" rel="noopener" class="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
          Saga in Temporal <ExternalLink class="size-3" />
        </a>
      </div>
    </div>

    <div class="grid gap-6 lg:grid-cols-3">
      <div class="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Balance movements</CardTitle>
            <CardDescription>Resolved from the tier's movement configuration: one amount type from one stock to another.</CardDescription>
          </CardHeader>
          <CardContent>
            <p v-if="!order.movements.length" class="text-sm text-muted-foreground">
              No movements.
            </p>
            <Table v-else>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Amount type</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead />
                  <TableHead>To</TableHead>
                  <TableHead class="text-right">
                    Amount
                  </TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="m in order.movements" :key="m.movementSequence">
                  <TableCell class="text-muted-foreground">
                    {{ m.movementSequence }}
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline">
                      {{ humanize(m.amountType) }}
                    </Badge>
                  </TableCell>
                  <TableCell class="max-w-44 truncate text-sm">
                    {{ stockLabel(m.fromStockId) }}
                  </TableCell>
                  <TableCell class="w-6 px-0">
                    <ArrowRight class="size-4 text-muted-foreground" />
                  </TableCell>
                  <TableCell class="max-w-44 truncate text-sm">
                    {{ stockLabel(m.toStockId) }}
                  </TableCell>
                  <TableCell class="text-right tabular-nums">
                    {{ formatMoney(m.amount, order.currency) }}
                  </TableCell>
                  <TableCell><StatusBadge :status="m.status" /></TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Ledger transactions</CardTitle>
            <CardDescription>The saga's Formance transactions, each posted once (reference = order id : step).</CardDescription>
          </CardHeader>
          <CardContent class="space-y-5">
            <Skeleton v-if="ledgerLoad === 'pending'" class="h-24 w-full" />
            <div v-for="tx in ledger" v-else :key="tx.step" :class="tx.status === 'PLANNED' && 'opacity-50'">
              <div class="mb-2 flex flex-wrap items-center gap-2">
                <span class="font-medium">{{ humanize(tx.step) }}</span>
                <StatusBadge :status="tx.status" />
                <span v-if="tx.ledgerTxId" class="text-xs text-muted-foreground">ledger tx {{ tx.ledgerTxId }}</span>
                <span class="text-xs text-muted-foreground">{{ tx.status === 'PLANNED' ? 'not needed' : STEP_HELP[tx.step] }}</span>
              </div>
              <Table v-if="tx.status !== 'PLANNED'">
                <TableBody>
                  <TableRow v-for="(p, i) in tx.postings" :key="i">
                    <TableCell class="max-w-56 truncate font-mono text-xs" :title="p.source">
                      {{ p.source }}
                    </TableCell>
                    <TableCell class="w-6 px-0">
                      <ArrowRight class="size-4 text-muted-foreground" />
                    </TableCell>
                    <TableCell class="max-w-56 truncate font-mono text-xs" :title="p.destination">
                      {{ p.destination }}
                    </TableCell>
                    <TableCell>
                      <Badge v-if="p.amountType" variant="outline">
                        {{ humanize(p.amountType) }}
                      </Badge>
                    </TableCell>
                    <TableCell class="text-right tabular-nums">
                      {{ formatMoney(p.amount, order.currency) }}
                    </TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      </div>

      <div class="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Amounts</CardTitle>
            <CardDescription>Calculated by the tier's amount rules.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl class="space-y-2 text-sm">
              <div v-for="a in order.amounts" :key="a.amountType" class="flex justify-between gap-4">
                <dt class="text-muted-foreground">
                  {{ humanize(a.amountType) }}
                </dt>
                <dd class="tabular-nums" :class="a.amountType === 'AMOUNT' && 'font-semibold'">
                  {{ formatMoney(a.amount, order.currency) }}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl class="space-y-2 text-sm">
              <div class="flex justify-between gap-4">
                <dt class="text-muted-foreground">
                  Service
                </dt>
                <dd>
                  <NuxtLink :to="`/services/${order.serviceCode}`" class="hover:underline">
                    {{ order.serviceCode }}
                  </NuxtLink>
                </dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-muted-foreground">
                  Payer
                </dt>
                <dd class="truncate text-right">
                  {{ stockLabel(order.payerAccountId) }}
                </dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-muted-foreground">
                  Payee
                </dt>
                <dd class="truncate text-right">
                  {{ stockLabel(order.payeeAccountId) }}
                </dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-muted-foreground">
                  External reference
                </dt>
                <dd class="truncate font-mono text-xs">
                  {{ order.externalReference ?? '—' }}
                </dd>
              </div>
              <div class="flex justify-between gap-4">
                <dt class="text-muted-foreground">
                  Created
                </dt>
                <dd>{{ formatDateTime(order.createdAt) }}</dd>
              </div>
              <div v-if="order.originalOrderId" class="flex justify-between gap-4">
                <dt class="text-muted-foreground">
                  Reverses
                </dt>
                <dd>
                  <NuxtLink :to="`/payments/${order.originalOrderId}`" class="font-mono hover:underline">
                    {{ shortId(order.originalOrderId) }}
                  </NuxtLink>
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status history</CardTitle>
          </CardHeader>
          <CardContent>
            <ol class="relative space-y-4 border-l pl-4">
              <li v-for="h in order.history" :key="h.id">
                <span class="absolute -left-1.5 mt-1 size-3 rounded-full border bg-background" />
                <div class="flex flex-wrap items-center gap-2">
                  <StatusBadge :status="h.toStatus" />
                  <span class="text-xs text-muted-foreground">{{ formatDateTime(h.changedAt) }}</span>
                </div>
                <p class="mt-1 text-xs text-muted-foreground">
                  {{ h.changedBy }}<template v-if="h.reasonCode">
                    · {{ humanize(h.reasonCode) }}
                  </template>
                </p>
              </li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>
