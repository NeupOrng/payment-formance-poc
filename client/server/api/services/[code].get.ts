export default defineEventHandler((event) => backend<ServiceConfig>('payment', `/services/${getRouterParam(event, 'code')}`))
