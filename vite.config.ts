import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  base: './',
  server: {
    port: 3000,
    strictPort: true,
    host: true,
    proxy: {
      '/mp-api': {
        target: 'https://api.mercadopago.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/mp-api/, ''),
      },
    },
  },
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'El Café del Constructor - POS',
        short_name: 'Café POS',
        description: 'Sistema de punto de venta para El Café del Constructor',
        theme_color: '#0f172a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'any',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
        runtimeCaching: [
          // Menú: StaleWhileRevalidate — carga inmediato desde caché, actualiza en background
          {
            urlPattern: /^https:\/\/lycrdngkgnkvduahkljk\.supabase\.co\/rest\/v1\/menu.*/i,
            handler: 'StaleWhileRevalidate',
            options: { cacheName: 'menu-cache', expiration: { maxAgeSeconds: 86400 } }
          },
          // Resto de Supabase: NetworkFirst con timeout corto, fallback a caché
          {
            urlPattern: /^https:\/\/lycrdngkgnkvduahkljk\.supabase\.co\/.*/i,
            handler: 'NetworkFirst',
            options: { cacheName: 'supabase-cache', networkTimeoutSeconds: 3 }
          }
        ]
      }
    })
  ],
})
