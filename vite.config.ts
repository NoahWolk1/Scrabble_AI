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
        // Match server: allow proxying when scrabblecam HTTPS cert is not trusted
        secure: false,
        rewrite: (path) => path.replace(/^\/api\/scrabblecam/, ''),
      },
      '/api/elevenlabs/transcribe': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: () => '/el-transcribe',
      },
      '/api/elevenlabs/tts': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: () => '/el-tts',
      },
      '/api/gemini': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/gemini/, ''),
      },
    },
  },
})
