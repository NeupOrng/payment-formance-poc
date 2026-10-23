export default defineEventHandler((event) =>
  backend<CustomerWithAccounts>('customer', `/customers/${getRouterParam(event, 'id')}`),
)
