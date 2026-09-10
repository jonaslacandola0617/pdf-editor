import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
  build: {
    target: 'es2022',
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes('/node_modules/')) return undefined
          if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) return 'react'
          if (id.includes('/node_modules/pdfjs-dist/')) return 'pdfjs'
          if (id.includes('/node_modules/pdf-lib/')) return 'pdf-lib'
          if (id.includes('/node_modules/tesseract.js/') || id.includes('/node_modules/tesseract.js-core/')) return 'ocr'
          if (id.includes('/node_modules/@hyzyla/pdfium/')) return 'pdfium'
          if (id.includes('/node_modules/qpdf-run/')) return 'qpdf'
          if (id.includes('/node_modules/lucide-react/')) return 'icons'
          if (id.includes('/node_modules/idb/')) return 'storage'
          return 'vendor'
        },
      },
    },
  },
})
