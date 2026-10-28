import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  optimizeDeps: {
    // Pre-bundle every heavy dependency at startup. Without this, Vite discovers some of them only
    // when a lazy page first loads, re-bundles, and the page can briefly load two copies of React.
    include: [
      'react',
      'react-dom',
      'react-router-dom',
      'react-dropzone',
      'framer-motion',
      'gsap',
      'gsap/ScrollTrigger',
      'recharts',
      'three',
      'three/examples/jsm/geometries/RoundedBoxGeometry.js',
      '@react-three/fiber',
      '@react-three/drei',
      'zustand',
      'zustand/middleware',
      'zod',
    ],
  },
  build: {
    // three.js + @react-three is ~820 kB minified (220 kB gzip). It is lazy-loaded only when a 3D
    // scene is on screen, so the limit is raised for that one chunk instead of splitting three.js.
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5173,
    // The backend CORS list (spec A3) only allows port 5173, so never fall back to another port.
    strictPort: true,
  },
})
