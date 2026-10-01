import { getAuthToken } from 'deepspace'

/** Call a server action. Resolves with `data` or throws an Error carrying the server's message. */
export async function callAction<T = unknown>(name: string, params: Record<string, unknown>): Promise<T> {
  const token = await getAuthToken()
  const res = await fetch(`/api/actions/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(params),
  })
  let body: { success?: boolean; data?: T; error?: string } = {}
  try { body = await res.json() } catch { /* non-JSON error page */ }
  if (!res.ok || !body.success) throw new Error(body.error || `Request failed (${res.status})`)
  return body.data as T
}
