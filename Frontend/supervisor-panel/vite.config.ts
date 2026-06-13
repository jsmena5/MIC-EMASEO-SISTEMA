import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  assetsInclude: ['**/*.png'],
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text-summary'],
      reportsDirectory: './coverage',
      exclude: [
        'src/features/dashboard/pages/**',
        'src/features/incidents/**',
        'src/features/auth/AuthGuard*',
        'src/features/auth/AuthContext*',
        'src/components/**',
        '**/__tests__/**',
        '**/*.test.*',
        'src/main.tsx',
        'src/App.tsx',
      ],
    },
  },
})