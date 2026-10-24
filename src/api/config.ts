const configuredUrl = import.meta.env.VITE_BACKEND_URL
if (!configuredUrl) throw new Error('Укажите VITE_BACKEND_URL в .env')

// В dev/preview работает Vite proxy. В production нужен доступный браузеру URL.
export const backendUrl = new URL(configuredUrl).origin
export const apiBaseUrl = import.meta.env.DEV ? '' : backendUrl

export function apiUrl(path: `/${string}`): string {
  return `${apiBaseUrl}${path}`
}
