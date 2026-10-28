<script setup lang="ts">
import { ArrowLeft, ArrowRight } from 'lucide-vue-next'

const route = useRoute()
const { data: svc, error } = await useFetch<ServiceConfig>(`/api/services/${route.params.code}`)
if (error.value) throw createError({ statusCode: error.value.statusCode ?? 500, statusMessage: error.value.statusMessage, fatal: true })

const specificIds = computed(() =>
  [...new Set((svc.value?.commands ?? []).flatMap(c => c.tiers.flatMap(t => t.movements.flatMap(m => [m.fromStockId, m.toStockId]))).filter(Boolean))].join(','),
)
const { data: stockViews } = useLazyFetch<StockView[]>('/api/stocks', { query: computed(() => ({ ids: specificIds.value })), default: () => [], immediate: !!specificIds.value })
const end = (role: string, stockId: string | null) => {
  if (role !== 'SPECIFIC') return humanize(role)
  const s = stockViews.value.find(x => x.id === stockId)
  return s ? `${s.profile.fullName} · ${s.account.name ?? PRODUCT_LABELS[s.account.productType]}` : shortId(stockId ?? '')
}

const range = (t: { minAmount: string | null, maxAmount: string | null }) => {
  const c = svc.value!.currency
  if (!t.minAmount && !t.maxAmount) return 'Any amount'
  if (!t.maxAmount) return `From ${formatMoney(t.minAmount, c)}`
  return `${t.minAmount ? formatMoney(t.minAmount, c) : 'Up'} – below ${formatMoney(t.maxAmount, c)}`
}
const describe = (r: TierRule) => {
  let text = r.calcMethod === 'FORMULA'
    ? r.formulaExpression!
    : [r.fixedValue && formatMoney(r.fixedValue, svc.value!.currency), r.percentage && `${Number(r.percentage)}% of ${r.baseAmountType}`].filter(Boolean).join(' + ')
  if (r.minValue) text += ` · min ${formatMoney(r.minValue, svc.value!.currency)}`
  if (r.maxValue) text += ` · max ${formatMoney(r.maxValue, svc.value!.currency)}`
  return text
}
</script>

<template>
  <div v-if="svc" class="space-y-6">
    <NuxtLink to="/services" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
      <ArrowLeft class="size-4" /> Services
    </NuxtLink>
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">
          {{ svc.name }}
        </h1>
        <p class="text-sm text-muted-foreground">
          <span class="font-mono">{{ svc.code }}</span> · {{ svc.currency }}
        </p>
      </div>
      <StatusBadge :status="svc.status" />
    </div>

    <Card v-for="cmd in svc.commands" :key="cmd.id">
      <CardHeader>
        <CardTitle>{{ humanize(cmd.commandType) }}</CardTitle>
        <CardAction>
          <StatusBadge :status="cmd.status" />
        </CardAction>
      </CardHeader>
      <CardContent class="space-y-6">
        <div v-if="cmd.spis.length">
          <h3 class="mb-2 text-sm font-medium">
            SPI calls
          </h3>
          <ul class="space-y-1 text-sm">
            <li v-for="s in cmd.spis" :key="s.id" class="flex flex-wrap items-center gap-2">
              <Badge variant="outline">
                {{ humanize(s.triggerStage) }} {{ s.executionSequence }}
              </Badge>
              <span class="font-mono text-xs">{{ s.spi.code }}</span>
              <span class="text-muted-foreground">{{ s.spiOperation }}</span>
            </li>
          </ul>
        </div>

        <div v-for="t in cmd.tiers" :key="t.id" class="space-y-3 rounded-lg border p-4" :class="t.status !== 'ACTIVE' && 'opacity-50'">
          <div class="flex items-center justify-between">
            <span class="font-medium">{{ range(t) }}</span>
            <StatusBadge :status="t.status" />
          </div>
          <div class="grid gap-4 md:grid-cols-2">
            <div>
              <h4 class="mb-1 text-xs font-medium text-muted-foreground uppercase">
                Amount rules
              </h4>
              <p v-if="!t.rules.length" class="text-sm text-muted-foreground">
                Amount only
              </p>
              <dl class="space-y-1 text-sm">
                <div v-for="r in t.rules" :key="r.id" class="flex justify-between gap-3">
                  <dt>{{ r.calcSequence }}. {{ humanize(r.amountType) }}</dt>
                  <dd class="text-right font-mono text-xs text-muted-foreground">
                    {{ describe(r) }}
                  </dd>
                </div>
              </dl>
            </div>
            <div>
              <h4 class="mb-1 text-xs font-medium text-muted-foreground uppercase">
                Balance movements
              </h4>
              <ul class="space-y-1 text-sm">
                <li v-for="m in t.movements" :key="m.id" class="flex flex-wrap items-center gap-1">
                  <span class="text-muted-foreground">{{ m.movementSequence }}.</span>
                  <Badge variant="outline">
                    {{ humanize(m.amountType) }}
                  </Badge>
                  <span>{{ end(m.fromStockRole, m.fromStockId) }}</span>
                  <ArrowRight class="size-3 text-muted-foreground" />
                  <span>{{ end(m.toStockRole, m.toStockId) }}</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  </div>
</template>
