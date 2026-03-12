import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/scrabblecam': {
        target: 'https://scrabblecam.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/scrabblecam/, ''),
      },
      '/api/gemini': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/gemini/, ''),
      },
    },
  },
})
