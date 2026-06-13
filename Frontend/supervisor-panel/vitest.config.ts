import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    coverage: {
      provider: 'v8',
      reporter: ['lcov', 'text-summary'],
      reportsDirectory: './coverage',
      exclude: [
        'src/features/dashboard/pages/**',
        'src/features/incidents/**',
        'src/features/auth/AuthGuard*',
        'src/features/auth/AuthContext*',
        'src/features/dashboard/Sidebar*',
        'src/features/dashboard/Topbar*',
        'src/features/dashboard/DashboardLayout*',
        'src/components/**',
        '**/__tests__/**',
        '**/*.test.*',
        'src/main.tsx',
        'src/App.tsx',
        'src/app/router.tsx',
        'src/config/**',
      ],
    },
  },
})
