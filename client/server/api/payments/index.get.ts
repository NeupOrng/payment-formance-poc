export default defineEventHandler((event) => {
  const { stockId, customerId, status, commandType, limit, offset } = getQuery(event)
  return backend<PaymentOrder[]>('payment', '/payments', { stockId, customerId, status, commandType, limit, offset })
})
