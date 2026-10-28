<script setup lang="ts">
const { data: services, error } = await useFetch<ServiceSummary[]>('/api/services', { default: () => [] })
if (error.value) throw createError({ statusCode: error.value.statusCode ?? 500, statusMessage: error.value.statusMessage, fatal: true })

const groups = computed(() => {
  const map = new Map<string, ServiceSummary[]>()
  for (const s of services.value) map.set(s.group.name, [...(map.get(s.group.name) ?? []), s])
  return [...map]
})
</script>

<template>
  <div class="space-y-6">
    <div>
      <h1 class="text-2xl font-semibold tracking-tight">
        Services
      </h1>
      <p class="text-sm text-muted-foreground">
        Each service works in one currency and has PAYMENT, REFUND and CANCEL commands with their own tiers and SPI calls.
      </p>
    </div>
    <section v-for="[group, list] in groups" :key="group" class="space-y-2">
      <h2 class="text-sm font-medium text-muted-foreground">
        {{ group }}
      </h2>
      <Card class="py-0">
        <Table>
          <TableBody>
            <TableRow v-for="s in list" :key="s.id" class="cursor-pointer" @click="navigateTo(`/services/${s.code}`)">
              <TableCell>
                <NuxtLink :to="`/services/${s.code}`" class="font-medium hover:underline" @click.stop>
                  {{ s.name }}
                </NuxtLink>
                <div class="font-mono text-xs text-muted-foreground">
                  {{ s.code }}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant="outline">
                  {{ s.currency }}
                </Badge>
              </TableCell>
              <TableCell class="text-right">
                <StatusBadge :status="s.status" />
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>
    </section>
  </div>
</template>
