<script setup lang="ts">
import type { NuxtError } from '#app'

const props = defineProps<{ error: NuxtError }>()
</script>

<template>
  <NuxtLayout>
    <Card class="mx-auto max-w-md">
      <CardHeader>
        <CardTitle>{{ props.error.statusCode === 404 ? 'Not found' : 'Something went wrong' }}</CardTitle>
        <CardDescription>{{ props.error.statusMessage || props.error.message }}</CardDescription>
      </CardHeader>
      <CardFooter>
        <Button @click="clearError({ redirect: '/' })">
          Back to profiles
        </Button>
      </CardFooter>
    </Card>
  </NuxtLayout>
</template>
