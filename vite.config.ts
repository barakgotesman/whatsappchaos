import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'), // allows imports like @/components/...
    },
  },
  server: {
    // Proxy /api/* to the Vercel dev server (port 3000) so serverless functions
    // work during local development. Run `vercel dev` to start that server.
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
  test: {
    environment: 'node',
    globals: true,
  },
})
