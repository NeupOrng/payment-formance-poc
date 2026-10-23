<script setup lang="ts">
import { ArrowLeft, ArrowRight } from 'lucide-vue-next'

const route = useRoute()
const id = route.params.id as string

const { data: transfer, error } = await useFetch<TransferWithEvents>(`/api/transfers/${id}`)
if (error.value) {
  throw createError({ statusCode: error.value.statusCode ?? 500, statusMessage: error.value.statusMessage, fatal: true })
}

const { data: ledgerTx, status: ledgerLoad } = useLazyFetch<LedgerTransaction | null>(`/api/transfers/${id}/ledger`)
const { data: services } = useLazyFetch<Service[]>('/api/services', { default: () => [] })
const service = computed(() => services.value.find(s => s.id === transfer.value?.serviceId))

const TYPE_ORDER = Object.keys(AMOUNT_TYPE_LABELS) as AmountType[]
const amounts = computed(() =>
  [...(transfer.value?.amounts ?? [])].sort((a, b) => TYPE_ORDER.indexOf(a.amountType) - TYPE_ORDER.indexOf(b.amountType)),
)

const parties = computed(() => {
  const t = transfer.value!
  return [
    { role: 'Payer (source)', customerId: t.sourceCustomerId, net: t.sourceNet },
    { role: 'Payee (destination)', customerId: t.destinationCustomerId, net: t.destinationNet },
  ].filter(p => p.customerId)
})

const details = computed(() => {
  const t = transfer.value!
  return [
    ['Type', TYPE_LABELS[t.type]],
    ['Service', t.serviceId ? (service.value ? `${service.value.serviceName} (${service.value.serviceCode})` : '…') : 'Bank transfer'],
    ['Currency', `${t.currency} (${t.asset})`],
    ['Created', formatDateTime(t.createdAt)],
    ['External ref', t.externalRef ?? '—'],
    ['Ledger tx', t.ledgerTxId ?? '—'],
  ]
})
</script>

<template>
  <div v-if="transfer" class="space-y-6">
    <NuxtLink
      :to="`/customers/${transfer.sourceCustomerId ?? transfer.destinationCustomerId}`"
      class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft class="size-4" /> Back to customer
    </NuxtLink>

    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <p class="text-sm text-muted-foreground">
          {{ TYPE_LABELS[transfer.type] }} · <span class="font-mono">{{ transfer.id }}</span>
        </p>
        <h1 class="text-3xl font-semibold tabular-nums">
          {{ formatMoney(transfer.amount, transfer.currency) }}
        </h1>
      </div>
      <div class="text-right">
        <StatusBadge :status="transfer.status" />
        <p v-if="transfer.failureReason" class="mt-1 text-sm text-destructive">
          {{ transfer.failureReason.replaceAll('_', ' ') }}
        </p>
      </div>
    </div>

    <div class="grid gap-6 lg:grid-cols-3">
      <div class="space-y-6 lg:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Ledger postings</CardTitle>
            <CardDescription>
              What actually moved in Formance, in one atomic transaction. Each posting settles a debit
              entry (debit type) against a credit entry (credit type) of the balance movement.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Skeleton v-if="ledgerLoad === 'pending'" class="h-24 w-full" />
            <p v-else-if="!ledgerTx" class="text-sm text-muted-foreground">
              Nothing was posted to the ledger{{ transfer.status === 'pending' ? ' yet' : '' }}.
            </p>
            <Table v-else>
              <TableHeader>
                <TableRow>
                  <TableHead>From</TableHead>
                  <TableHead />
                  <TableHead>To</TableHead>
                  <TableHead>Debit type</TableHead>
                  <TableHead>Credit type</TableHead>
                  <TableHead class="text-right">
                    Amount
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="(p, i) in ledgerTx.postings" :key="i">
                  <TableCell class="max-w-40 truncate font-mono text-xs" :title="p.source">
                    {{ p.source }}
                  </TableCell>
                  <TableCell class="w-6 px-0">
                    <ArrowRight class="size-4 text-muted-foreground" />
                  </TableCell>
                  <TableCell class="max-w-40 truncate font-mono text-xs" :title="p.destination">
                    {{ p.destination }}
                  </TableCell>
                  <TableCell>
                    <Badge v-if="p.debitType" variant="outline">
                      {{ AMOUNT_TYPE_LABELS[p.debitType] }}
                    </Badge>
                    <span v-else class="text-muted-foreground">—</span>
                  </TableCell>
                  <TableCell>
                    <Badge v-if="p.creditType" variant="outline">
                      {{ AMOUNT_TYPE_LABELS[p.creditType] }}
                    </Badge>
                    <span v-else class="text-muted-foreground">—</span>
                  </TableCell>
                  <TableCell class="text-right tabular-nums">
                    {{ formatMoney(p.amount, transfer.currency) }}
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Amount types</CardTitle>
            <CardDescription>Calculated from the command's pricing tiers when the transaction ran.</CardDescription>
          </CardHeader>
          <CardContent>
            <dl class="grid gap-x-8 gap-y-2 text-sm sm:grid-cols-2">
              <div v-for="a in amounts" :key="a.amountType" class="flex justify-between gap-4">
                <dt class="text-muted-foreground">
                  {{ AMOUNT_TYPE_LABELS[a.amountType] }}
                </dt>
                <dd class="tabular-nums" :class="a.amountType === 'amount' && 'font-semibold'">
                  {{ formatMoney(a.amount, transfer.currency) }}
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <div class="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle>Customers</CardTitle>
          </CardHeader>
          <CardContent class="space-y-3 text-sm">
            <div v-for="p in parties" :key="p.role" class="flex items-start justify-between gap-4">
              <div>
                <div class="text-muted-foreground">
                  {{ p.role }}
                </div>
                <NuxtLink :to="`/customers/${p.customerId}`" class="font-mono text-xs hover:underline">
                  {{ shortId(p.customerId!) }}
                </NuxtLink>
              </div>
              <span
                class="font-semibold tabular-nums"
                :class="BigInt(p.net ?? 0) > 0n && 'text-emerald-600'"
              >
                {{ BigInt(p.net ?? 0) > 0n ? '+' : '' }}{{ formatMoney(p.net ?? 0, transfer.currency) }}
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl class="space-y-2 text-sm">
              <div v-for="[label, value] in details" :key="label" class="flex justify-between gap-4">
                <dt class="text-muted-foreground">
                  {{ label }}
                </dt>
                <dd class="truncate text-right">
                  {{ value }}
                </dd>
              </div>
              <div v-if="transfer.originalTransferId" class="flex justify-between gap-4">
                <dt class="text-muted-foreground">
                  Reverses
                </dt>
                <dd>
                  <NuxtLink :to="`/transfers/${transfer.originalTransferId}`" class="font-mono hover:underline">
                    {{ shortId(transfer.originalTransferId) }}
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
              <li v-for="e in transfer.events" :key="e.id">
                <span class="absolute -left-1.5 mt-1 size-3 rounded-full border bg-background" />
                <div class="flex items-center gap-2">
                  <StatusBadge :status="e.toStatus" />
                  <span class="text-xs text-muted-foreground">{{ formatDateTime(e.at) }}</span>
                </div>
                <p v-if="e.reason" class="mt-1 text-xs text-muted-foreground">
                  {{ e.reason.replaceAll('_', ' ') }}
                </p>
              </li>
            </ol>
          </CardContent>
        </Card>
      </div>
    </div>
  </div>
</template>
