export default defineEventHandler((event) =>
  backend<Balance[]>('payment', `/customers/${getRouterParam(event, 'id')}/balances`),
)
