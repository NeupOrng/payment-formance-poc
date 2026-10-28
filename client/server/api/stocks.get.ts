/** Stocks with their account and owner, e.g. to name the stocks a movement touches. */
export default defineEventHandler((event) => backend<StockView[]>('profile', '/stocks', { ids: getQuery(event).ids }))
