import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

const BASE = '/norcal-hockey-rankings/'

export default defineConfig({
  base: BASE,
  plugins: [react()],
  define: {
    // Stamped at build time so a running page can report exactly which build it is.
    __BUILD_ID__: JSON.stringify(
      process.env.GITHUB_SHA?.slice(0, 7) ??
        new Date().toISOString().slice(0, 16).replace('T', ' '),
    ),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
})
