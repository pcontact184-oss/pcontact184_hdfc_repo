import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ command }) => {
  return {
    base: command === 'build' && process.env.GITHUB_ACTIONS ? '/pcontact184_hdfc_repo/' : '/',
    plugins: [react()],
    server: {
      port: 5174,
      strictPort: true
    }
  }
})