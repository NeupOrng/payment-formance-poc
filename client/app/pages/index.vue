<script setup lang="ts">
import { Search } from 'lucide-vue-next'

const type = ref<'all' | ProfileType>('all')
const search = ref('')
const { data: profiles, status, error, refresh } = await useFetch<Profile[]>('/api/profiles', {
  query: computed(() => ({ type: type.value === 'all' ? undefined : type.value })),
})

const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  const list = profiles.value ?? []
  if (!q) return list
  return list.filter(p => p.fullName.toLowerCase().includes(q) || p.profileNumber.toLowerCase().includes(q) || (p.phoneNumber ?? '').includes(q))
})
</script>

<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">
          Profiles
        </h1>
        <p class="text-sm text-muted-foreground">
          Customers, agents and the bank's own accounts. Open one to see its stocks and payment orders.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Tabs v-model="type">
          <TabsList>
            <TabsTrigger value="all">
              All
            </TabsTrigger>
            <TabsTrigger value="INDIVIDUAL">
              Individual
            </TabsTrigger>
            <TabsTrigger value="AGENT">
              Agent
            </TabsTrigger>
            <TabsTrigger value="INTERNAL">
              Internal
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div class="relative w-64">
          <Search class="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input v-model="search" placeholder="Name, CIF or phone" class="pl-8" />
        </div>
      </div>
    </div>

    <Card v-if="error" class="border-destructive/50">
      <CardHeader>
        <CardTitle>Could not load profiles</CardTitle>
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
            <TableHead>Type</TableHead>
            <TableHead>Phone</TableHead>
            <TableHead>Status</TableHead>
            <TableHead class="text-right">
              Created
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
          <TableRow v-for="p in filtered" v-else :key="p.id" class="cursor-pointer" @click="navigateTo(`/profiles/${p.id}`)">
            <TableCell>
              <NuxtLink :to="`/profiles/${p.id}`" class="font-medium hover:underline" @click.stop>
                {{ p.fullName }}
              </NuxtLink>
              <div class="font-mono text-xs text-muted-foreground">
                {{ p.profileNumber }}
              </div>
            </TableCell>
            <TableCell>
              <Badge variant="outline">
                {{ humanize(p.profileType) }}
              </Badge>
            </TableCell>
            <TableCell class="tabular-nums text-muted-foreground">
              {{ p.phoneNumber ?? '—' }}
            </TableCell>
            <TableCell><StatusBadge :status="p.status" /></TableCell>
            <TableCell class="text-right text-muted-foreground">
              {{ formatDateTime(p.createdAt) }}
            </TableCell>
          </TableRow>
          <TableEmpty v-if="status !== 'pending' && !filtered.length" :colspan="5">
            No profiles match.
          </TableEmpty>
        </TableBody>
      </Table>
    </Card>
  </div>
</template>
