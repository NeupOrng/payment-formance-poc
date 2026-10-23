export default defineEventHandler((event) => {
  const { currency, type, status, limit, offset } = getQuery(event)
  return backend<Transfer[]>('payment', '/transfers', {
    customerId: getRouterParam(event, 'id'),
    currency,
    type,
    status,
    limit,
    offset,
  })
})
