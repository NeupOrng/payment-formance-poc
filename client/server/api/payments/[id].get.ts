export default defineEventHandler((event) => backend<PaymentOrderDetail>('payment', `/payments/${getRouterParam(event, 'id')}`))
