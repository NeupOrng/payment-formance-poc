<script setup lang="ts">
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, ChevronLeft, ChevronRight, RefreshCw } from 'lucide-vue-next'

const PAGE_SIZE = 20
const route = useRoute()
const id = route.params.id as string

const { data: customer, error } = await useFetch<CustomerWithAccounts>(`/api/customers/${id}`)
if (error.value) {
  throw createError({ statusCode: error.value.statusCode ?? 500, statusMessage: error.value.statusMessage, fatal: true })
}

const { data: balances, status: balanceStatus, refresh: refreshBalances } = useLazyFetch<Balance[]>(`/api/customers/${id}/balances`)
const { data: services } = useLazyFetch<Service[]>('/api/services', { default: () => [] })
const serviceNames = computed(() => new Map(services.value.map(s => [s.id, s.serviceName])))

const currency = ref<'all' | Currency>('all')
const type = ref<'all' | TransferType>('all')
const transferStatus = ref<'all' | TransferStatus>('all')
const page = ref(0)
watch([currency, type, transferStatus], () => (page.value = 0))

const query = computed(() => ({
  currency: currency.value === 'all' ? undefined : currency.value,
  type: type.value === 'all' ? undefined : type.value,
  status: transferStatus.value === 'all' ? undefined : transferStatus.value,
  limit: PAGE_SIZE,
  offset: page.value * PAGE_SIZE,
}))
const { data: transfers, status: transferLoad, refresh: refreshTransfers } = useLazyFetch<Transfer[]>(
  `/api/customers/${id}/transfers`,
  { query, default: () => [] },
)
const hasNext = computed(() => transfers.value.length === PAGE_SIZE)

const balanceFor = (c: Currency) => balances.value?.find(b => b.currency === c)
const CURRENCY_ORDER: Currency[] = ['USD', 'KHR']
const accounts = computed(() =>
  [...(customer.value?.accounts ?? [])].sort((a, b) => CURRENCY_ORDER.indexOf(a.currency) - CURRENCY_ORDER.indexOf(b.currency)),
)

function refreshAll() {
  refreshBalances()
  refreshTransfers()
}
</script>

<template>
  <div v-if="customer" class="space-y-8">
    <div class="space-y-4">
      <NuxtLink to="/" class="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft class="size-4" /> Customers
      </NuxtLink>
      <div class="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">
            {{ customer.fullName }}
          </h1>
          <p class="text-sm text-muted-foreground">
            {{ customer.phoneNumber }} · <span class="font-mono">{{ customer.id }}</span>
          </p>
          <div class="mt-2 flex gap-2">
            <StatusBadge :status="customer.status" />
            <Badge variant="outline">
              KYC {{ customer.kycStatus }}
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
        Assets
      </h2>
      <div class="grid gap-4 sm:grid-cols-2">
        <BalanceCard
          v-for="account in accounts"
          :key="account.id"
          :account="account"
          :balance="balanceFor(account.currency)"
          :loading="balanceStatus === 'pending'"
        />
      </div>
      <p class="text-xs text-muted-foreground">
        Balances are read live from the Formance ledger.
      </p>
    </section>

    <section class="space-y-3">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <h2 class="text-lg font-semibold">
          Transaction history
        </h2>
        <div class="flex flex-wrap items-center gap-2">
          <Tabs v-model="currency">
            <TabsList>
              <TabsTrigger value="all">
                All
              </TabsTrigger>
              <TabsTrigger value="USD">
                USD
              </TabsTrigger>
              <TabsTrigger value="KHR">
                KHR
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <Select v-model="type">
            <SelectTrigger class="w-36">
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                All types
              </SelectItem>
              <SelectItem v-for="(label, value) in TYPE_LABELS" :key="value" :value="value">
                {{ label }}
              </SelectItem>
            </SelectContent>
          </Select>
          <Select v-model="transferStatus">
            <SelectTrigger class="w-36">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">
                All statuses
              </SelectItem>
              <SelectItem value="posted">
                Posted
              </SelectItem>
              <SelectItem value="pending">
                Pending
              </SelectItem>
              <SelectItem value="failed">
                Failed
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
              <TableHead>Type</TableHead>
              <TableHead>Service</TableHead>
              <TableHead class="text-right">
                Amount
              </TableHead>
              <TableHead class="text-right">
                Net to customer
              </TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <template v-if="transferLoad === 'pending' && !transfers.length">
              <TableRow v-for="i in 5" :key="i">
                <TableCell v-for="j in 6" :key="j">
                  <Skeleton class="h-4 w-full" />
                </TableCell>
              </TableRow>
            </template>
            <TableRow
              v-for="t in transfers"
              :key="t.id"
              class="cursor-pointer"
              @click="navigateTo(`/transfers/${t.id}`)"
            >
              <TableCell class="whitespace-nowrap text-muted-foreground">
                {{ formatDateTime(t.createdAt) }}
              </TableCell>
              <TableCell>
                <span class="inline-flex items-center gap-1.5">
                  <ArrowDownLeft v-if="netFor(t, id) > 0n" class="size-4 text-emerald-600" />
                  <ArrowUpRight v-else class="size-4 text-muted-foreground" />
                  {{ TYPE_LABELS[t.type] }}
                </span>
                <div class="text-xs text-muted-foreground">
                  {{ t.sourceCustomerId === id ? 'as payer' : 'as payee' }}
                </div>
              </TableCell>
              <TableCell>
                {{ t.serviceId ? serviceNames.get(t.serviceId) ?? '—' : 'Bank transfer' }}
                <div v-if="t.externalRef" class="max-w-48 truncate font-mono text-xs text-muted-foreground">
                  {{ t.externalRef }}
                </div>
              </TableCell>
              <TableCell class="text-right tabular-nums text-muted-foreground" :class="t.status === 'failed' && 'line-through'">
                {{ formatMoney(t.amount, t.currency) }}
              </TableCell>
              <TableCell
                class="text-right font-medium tabular-nums"
                :class="[netFor(t, id) > 0n && 'text-emerald-600', t.status === 'failed' && 'text-muted-foreground line-through']"
              >
                {{ netFor(t, id) > 0n ? '+' : '' }}{{ formatMoney(netFor(t, id), t.currency) }}
              </TableCell>
              <TableCell>
                <StatusBadge :status="t.status" />
                <div v-if="t.failureReason" class="text-xs text-destructive">
                  {{ t.failureReason.replaceAll('_', ' ') }}
                </div>
              </TableCell>
            </TableRow>
            <TableEmpty v-if="transferLoad !== 'pending' && !transfers.length" :colspan="6">
              No transactions match these filters.
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
          <Button variant="outline" size="sm" :disabled="!hasNext" @click="page++">
            Next <ChevronRight class="size-4" />
          </Button>
        </div>
      </div>
    </section>
  </div>
</template>
