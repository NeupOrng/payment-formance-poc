<script setup lang="ts">
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, Wallet } from 'lucide-vue-next'

const PAGE_SIZE = 20
const route = useRoute()
const id = route.params.id as string

const { data: profile, error, refresh: refreshProfile } = await useFetch<ProfileWithAccounts>(`/api/profiles/${id}`)
if (error.value) throw createError({ statusCode: error.value.statusCode ?? 500, statusMessage: error.value.statusMessage, fatal: true })

const stocks = computed(() =>
  (profile.value?.accounts ?? []).flatMap(a => a.stocks.map(s => ({ ...s, account: a }))),
)
const stockId = ref(stocks.value.find(s => s.currency === 'USD')?.id ?? stocks.value[0]?.id ?? '')
const selected = computed(() => stocks.value.find(s => s.id === stockId.value))

const statusFilter = ref<'all' | PaymentStatus>('all')
const commandFilter = ref<'all' | CommandType>('all')
const page = ref(0)
watch([stockId, statusFilter, commandFilter], () => (page.value = 0))

const { data: orders, status: ordersLoad, refresh: refreshOrders } = useLazyFetch<PaymentOrder[]>('/api/payments', {
  query: computed(() => ({
    stockId: stockId.value,
    status: statusFilter.value === 'all' ? undefined : statusFilter.value,
    commandType: commandFilter.value === 'all' ? undefined : commandFilter.value,
    limit: PAGE_SIZE,
    offset: page.value * PAGE_SIZE,
  })),
  default: () => [],
  immediate: !!stockId.value,
})

function refreshAll() {
  refreshProfile()
  refreshOrders()
}
</script>

<template>
  <div v-if="profile" class="space-y-8">
    <div class="space-y-4">
      <NuxtLink to="/" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft class="size-4" /> Profiles
      </NuxtLink>
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">
            {{ profile.fullName }}
          </h1>
          <p class="text-sm text-muted-foreground">
            <span class="font-mono">{{ profile.profileNumber }}</span>
            <template v-if="profile.phoneNumber">
              · {{ profile.phoneNumber }}
            </template>
          </p>
          <div class="mt-2 flex gap-2">
            <Badge variant="outline">
              {{ humanize(profile.profileType) }}
            </Badge>
            <StatusBadge :status="profile.status" />
            <Badge v-if="profile.profileType !== 'INTERNAL'" variant="outline">
              KYC {{ profile.kycVerified ? 'verified' : 'pending' }}
            </Badge>
          </div>
        </div>
        <Button variant="outline" size="sm" @click="refreshAll">
          <RefreshCw class="size-4" /> Refresh
        </Button>
      </div>
    </div>

    <section class="space-y-3">
      <h2 class="text-lg font-semibold">
        Stocks
      </h2>
      <p v-if="!stocks.length" class="text-sm text-muted-foreground">
        No accounts yet.
      </p>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card
          v-for="s in stocks"
          :key="s.id"
          class="cursor-pointer transition-colors"
          :class="s.id === stockId ? 'border-primary ring-1 ring-primary' : 'hover:border-foreground/30'"
          @click="stockId = s.id"
        >
          <CardHeader>
            <CardDescription class="flex items-center gap-2">
              <Wallet class="size-4" />
              {{ s.account.name ?? PRODUCT_LABELS[s.account.productType] }} · {{ s.currency }}
            </CardDescription>
            <CardTitle class="text-2xl tabular-nums">
              {{ formatMoney(s.availableBalance, s.currency) }}
            </CardTitle>
            <CardAction>
              <StatusBadge :status="s.status" />
            </CardAction>
          </CardHeader>
          <CardContent class="space-y-1 text-xs text-muted-foreground">
            <p class="flex justify-between">
              <span>Ledger balance</span><span class="tabular-nums">{{ formatMoney(s.ledgerBalance, s.currency) }}</span>
            </p>
            <p class="flex justify-between">
              <span>On hold</span><span class="tabular-nums">{{ formatMoney(s.holdAmount, s.currency) }}</span>
            </p>
            <p class="truncate font-mono" :title="s.ledgerAccount">
              {{ s.stockNumber }}
            </p>
          </CardContent>
        </Card>
      </div>
      <p class="text-xs text-muted-foreground">
        Available = ledger balance − hold. Balances are mirrored from the Formance ledger.
      </p>
    </section>

    <section v-if="selected" class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-lg font-semibold">
          Payment orders · stock {{ selected.stockNumber }} ({{ selected.currency }})
        </h2>
        <div class="flex flex-wrap gap-2">
          <Select v-model="commandFilter">
            <SelectTrigger class="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                All commands
              </SelectItem>
              <SelectItem v-for="c in ['PAYMENT', 'REFUND', 'CANCEL']" :key="c" :value="c">
                {{ humanize(c) }}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select v-model="statusFilter">
            <SelectTrigger class="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                All statuses
              </SelectItem>
              <SelectItem v-for="s in ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'CANCELLED', 'REVERSED']" :key="s" :value="s">
                {{ humanize(s) }}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card class="py-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Date</TableHead>
              <TableHead>Order</TableHead>
              <TableHead>Service</TableHead>
              <TableHead class="text-right">
                Amount
              </TableHead>
              <TableHead class="text-right">
                Net to this stock
              </TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="ordersLoad === 'pending' && !orders.length">
              <TableRow v-for="i in 4" :key="i">
                <TableCell v-for="j in 6" :key="j">
                  <Skeleton class="h-4 w-full" />
                </TableCell>
              </TableRow>
            </template>
            <TableRow v-for="o in orders" :key="o.id" class="cursor-pointer" @click="navigateTo(`/payments/${o.id}`)">
              <TableCell class="whitespace-nowrap text-muted-foreground">
                {{ formatDateTime(o.createdAt) }}
              </TableCell>
              <TableCell>
                <div class="font-mono text-xs">
                  {{ o.orderReference }}
                </div>
                <div class="text-xs text-muted-foreground">
                  {{ humanize(o.commandType) }} · {{ o.payeeAccountId === stockId ? `from ${o.payerName}` : `to ${o.payeeName ?? '—'}` }}
                </div>
              </TableCell>
              <TableCell>
                {{ o.serviceName }}
                <div v-if="o.externalReference" class="max-w-48 truncate font-mono text-xs text-muted-foreground">
                  {{ o.externalReference }}
                </div>
              </TableCell>
              <TableCell class="text-right tabular-nums text-muted-foreground">
                {{ formatMoney(o.amount, o.currency) }}
              </TableCell>
              <TableCell
                class="text-right font-medium tabular-nums"
                :class="[isPositive(o.netForStock) && 'text-emerald-600', ['FAILED', 'CANCELLED'].includes(o.status) && 'text-muted-foreground line-through']"
              >
                {{ isPositive(o.netForStock) ? '+' : '' }}{{ formatMoney(o.netForStock, o.currency) }}
              </TableCell>
              <TableCell>
                <StatusBadge :status="o.status" />
                <div v-if="o.statusReasonCode" class="text-xs text-muted-foreground">
                  {{ humanize(o.statusReasonCode) }}
                </div>
              </TableCell>
            </TableRow>
            <TableEmpty v-if="ordersLoad !== 'pending' && !orders.length" :colspan="6">
              No payment orders for this stock.
            </TableEmpty>
          </TableBody>
        </Table>
      </Card>

      <div class="flex items-center justify-between text-sm text-muted-foreground">
        <span>Page {{ page + 1 }}</span>
        <div class="flex gap-2">
          <Button variant="outline" size="sm" :disabled="page === 0" @click="page--">
            <ChevronLeft class="size-4" /> Previous
          </Button>
          <Button variant="outline" size="sm" :disabled="orders.length < PAGE_SIZE" @click="page++">
            Next <ChevronRight class="size-4" />
          </Button>
        </div>
      </div>
    </section>
  </div>
</template>
