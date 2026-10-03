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
  const serviceStatusUrl = parseEndpoint(env.SERVICE_STATUS_URL)
  const containerStatusUrl = parseEndpoint(env.CONTAINER_STATUS_URL)

  return {
    plugins: [vue()],
    server: {
      proxy: {
        '/netbox/graphql/': {
          target: env.NETBOX_URL,
          changeOrigin: true,
          rewrite: () => '/graphql/',
          headers: { Authorization: `Bearer ${env.NETBOX_TOKEN}` },
        },
        '/proxmox/': {
          target: env.PROXMOX_URL,
          changeOrigin: true,
          secure: false,
          rewrite: (path) => path.replace(/^\/proxmox/, ''),
          headers: { Authorization: `PVEAPIToken=${env.PROXMOX_TOKEN}` },
          bypass(req, res) {
            if (req.method !== 'GET') {
              res.statusCode = 405
              res.end('Method Not Allowed')
              return false
            }
            const path = (req.url || '').split('?')[0].replace(/^\/proxmox/, '')
            const isCluster = path === '/api2/json/cluster/resources'
            const isRrd = /^\/api2\/json\/nodes\/[^/]+\/rrddata$/.test(path)
            if (!isCluster && !isRrd) {
              res.statusCode = 404
              res.end('Not Found')
              return false
            }
          },
        },
        '/api/service-status': {
          target: serviceStatusUrl ? serviceStatusUrl.origin : 'http://localhost',
          changeOrigin: true,
          secure: false,
          rewrite: () => (serviceStatusUrl ? serviceStatusUrl.pathname + serviceStatusUrl.search : ''),
          bypass(req, res) {
            if (req.method !== 'GET') {
              res.statusCode = 405
              res.end('Method Not Allowed')
              return false
            }
            if (!serviceStatusUrl) {
              res.statusCode = 502
              res.end('SERVICE_STATUS_URL is not configured')
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
