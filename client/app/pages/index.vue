<script setup lang="ts">
import { Search } from 'lucide-vue-next'

const { data: customers, status, error, refresh } = await useFetch<Customer[]>('/api/customers')
const search = ref('')

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return customers.value ?? []
  return (customers.value ?? []).filter(c =>
    c.fullName.toLowerCase().includes(q) || c.phoneNumber.includes(q) || c.id.startsWith(q),
  )
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">
          Customers
        </h1>
        <p class="text-sm text-muted-foreground">
          Select a customer to see their USD and KHR balances and transaction history.
        </p>
      </div>
      <div class="relative w-full sm:w-72">
        <Search class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input v-model="search" placeholder="Search name, phone or ID" class="pl-8" />
      </div>
    </div>

    <Card v-if="error" class="border-destructive/50">
      <CardHeader>
        <CardTitle>Could not load customers</CardTitle>
        <CardDescription>{{ error.statusMessage || error.message }}</CardDescription>
        <CardAction>
          <Button variant="outline" size="sm" @click="refresh()">
            Retry
          </Button>
        </CardAction>
      </CardHeader>
    </Card>

    <Card v-else class="py-0">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>KYC</TableHead>
            <TableHead>Status</TableHead>
            <TableHead class="text-right">
              Joined
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <template v-if="status === 'pending'">
            <TableRow v-for="i in 5" :key="i">
              <TableCell v-for="j in 5" :key="j">
                <Skeleton class="h-4 w-full" />
              </TableCell>
            </TableRow>
          </template>
          <TableRow
            v-for="customer in filtered"
            v-else
            :key="customer.id"
            class="cursor-pointer"
            @click="navigateTo(`/customers/${customer.id}`)"
          >
            <TableCell>
              <NuxtLink :to="`/customers/${customer.id}`" class="font-medium hover:underline" @click.stop>
                {{ customer.fullName }}
              </NuxtLink>
              <div class="font-mono text-xs text-muted-foreground">
                {{ shortId(customer.id) }}
              </div>
            </TableCell>
            <TableCell class="tabular-nums">
              {{ customer.phoneNumber }}
            </TableCell>
            <TableCell><StatusBadge :status="customer.kycStatus" /></TableCell>
            <TableCell><StatusBadge :status="customer.status" /></TableCell>
            <TableCell class="text-right text-muted-foreground">
              {{ formatDateTime(customer.createdAt) }}
            </TableCell>
          </TableRow>
          <TableEmpty v-if="status !== 'pending' && !filtered.length" :colspan="5">
            {{ search ? 'No customer matches your search.' : 'No customers yet.' }}
          </TableEmpty>
        </TableBody>
      </Table>
    </Card>
  </div>
</template>
