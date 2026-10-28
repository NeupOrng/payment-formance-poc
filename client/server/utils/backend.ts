import { ofetch } from 'ofetch'

type Backend = 'profile' | 'payment'
type FetchFailure = {
  statusCode?: number
  statusMessage?: string
  data?: { message?: string | string[] }
}

/** Calls a backend service and turns its errors into H3 errors with the same status. */
export async function backend<T>(
  service: Backend,
  path: string,
  query?: Record<string, unknown>,
): Promise<T> {
  const config = useRuntimeConfig()
  const baseURL = service === 'profile' ? config.profileServiceUrl : config.paymentServiceUrl
  try {
    return await ofetch<T>(path, { baseURL, query, timeout: 10_000 })
  } catch (err) {
    const e = err as FetchFailure
    if (e.statusCode) {
      const message = e.data?.message
      throw createError({
        statusCode: e.statusCode,
        statusMessage: Array.isArray(message) ? message.join('; ') : (message ?? e.statusMessage),
      })
    }
    throw createError({ statusCode: 502, statusMessage: `${service} service unavailable` })
  }
}
