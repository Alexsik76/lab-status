/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

function parseEndpoint(rawUrl: string | undefined) {
  if (!rawUrl) return null
  try {
    return new URL(rawUrl)
  } catch {
    return null
  }
}

// Variables are read here only (no VITE_ prefix), so they
// are never exposed to the browser bundle.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // The backend (backend/) runs separately in development: uvicorn on port 8000 by default.
  const backendUrl = env.BACKEND_URL || 'http://127.0.0.1:8000'
  const containerStatusUrl = parseEndpoint(env.CONTAINER_STATUS_URL)

  return {
    plugins: [vue()],
    server: {
      proxy: {
        '/api/refresh': {
          target: backendUrl,
          bypass(req, res) {
            if (req.method !== 'POST') {
              res.statusCode = 405
              res.end('Method Not Allowed')
              return false
            }
          },
        },
        '/api/service-status': {
          target: backendUrl,
          bypass(req, res) {
            if (req.method !== 'GET') {
              res.statusCode = 405
              res.end('Method Not Allowed')
              return false
            }
          },
        },
        '/api/stream': {
          target: backendUrl,
          bypass(req, res) {
            if (req.method !== 'GET') {
              res.statusCode = 405
              res.end('Method Not Allowed')
              return false
            }
          },
        },
        '/api/container-status': {
          target: containerStatusUrl ? containerStatusUrl.origin : 'http://localhost',
          changeOrigin: true,
          secure: false,
          rewrite: () => (containerStatusUrl ? containerStatusUrl.pathname + containerStatusUrl.search : ''),
          bypass(req, res) {
            if (req.method !== 'GET') {
              res.statusCode = 405
              res.end('Method Not Allowed')
              return false
            }
            if (!containerStatusUrl) {
              res.statusCode = 502
              res.end('CONTAINER_STATUS_URL is not configured')
              return false
            }
          },
        },
      },
    },
    test: {
      environment: 'happy-dom',
      include: ['src/**/*.test.ts'],
    },
  }
})
