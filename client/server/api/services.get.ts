export default defineEventHandler(() => backend<Service[]>('payment', '/services'))
