import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_PROXY_TARGET

  return {
    plugins: [react(), tailwindcss()],
    assetsInclude: ['**/*.png'],
    ...(proxyTarget && {
      server: {
        proxy: {
          '/api': {
            target: proxyTarget,
            changeOrigin: true,
            secure: true,
          },
        },
      },
    }),
  }
})
