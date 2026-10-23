export default defineEventHandler((event) =>
  backend<TransferWithEvents>('payment', `/transfers/${getRouterParam(event, 'id')}`),
)
