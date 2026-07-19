import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Anon Aadhaar proves in-browser via snarkjs/wasm — needs these globals/headers.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 4300,
    // SharedArrayBuffer (snarkjs) wants cross-origin isolation.
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  define: { 'process.env': {} },
})
