import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// 端口与 proxy 目标是 design.md §1 的固定契约，不可改
export default defineConfig({
  plugins: [react()],
  server: {
    port: 8904,
    proxy: {
      '/api': 'http://localhost:8903',
    },
  },
})
