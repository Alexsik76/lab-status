import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'

// NETBOX_URL / NETBOX_TOKEN are read here only (no VITE_ prefix), so they
// are never exposed to the browser bundle.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')

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
      },
    },
  }
})
