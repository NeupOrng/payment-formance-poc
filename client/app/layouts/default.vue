<script setup lang="ts">
import { Landmark } from 'lucide-vue-next'
</script>

<template>
  <div class="min-h-screen bg-muted/30">
    <header class="border-b bg-background">
      <div class="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
        <NuxtLink to="/" class="flex items-center gap-2 font-semibold">
          <Landmark class="size-5" />
          Mobile Bank Console
        </NuxtLink>
        <nav class="text-sm text-muted-foreground">
          <NuxtLink to="/" class="hover:text-foreground" active-class="text-foreground">
            Customers
          </NuxtLink>
        </nav>
      </div>
    </header>
    <main class="mx-auto max-w-6xl px-4 py-8">
      <slot />
    </main>
  </div>
</template>
