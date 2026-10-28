export default defineEventHandler((event) => backend<LedgerTx[]>('payment', `/payments/${getRouterParam(event, 'id')}/ledger`))
