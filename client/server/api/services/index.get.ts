export default defineEventHandler(() => backend<ServiceSummary[]>('payment', '/services'))
