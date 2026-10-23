export default defineEventHandler(() => backend<Customer[]>('customer', '/customers', { limit: 200 }))
