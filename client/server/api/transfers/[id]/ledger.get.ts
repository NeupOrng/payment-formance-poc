export default defineEventHandler(async (event) =>
  // null while the transfer has no ledger transaction (pending or failed)
  (await backend<LedgerTransaction | ''>('payment', `/transfers/${getRouterParam(event, 'id')}/ledger`)) || null,
)
