import { defineConfig, loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const backendUrl = loadEnv(mode, process.cwd(), 'VITE_BACKEND_URL').VITE_BACKEND_URL
  if (!backendUrl) throw new Error('Укажите VITE_BACKEND_URL в .env')
  const target = new URL(backendUrl).origin
  const proxy = {
    '/api': { target, changeOrigin: true },
    '/health': { target, changeOrigin: true },
    '/hubs': { target, changeOrigin: true, ws: true },
    '/cards': { target, changeOrigin: true },
  }
  return {
    server: { host: '0.0.0.0', port: 3000, open: true, proxy },
    preview: { proxy },
  }
})
