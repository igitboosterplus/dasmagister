import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react-swc'
import { VitePWA } from 'vite-plugin-pwa'
import path from 'path'

export default defineConfig({
  plugins: [
    react(),

    VitePWA({
      registerType: 'autoUpdate',

      manifest: {
        name: 'sygopia.DasMagistere',
        short_name: 'Sygopia',
        description: 'application de gestion des presences',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',

        icons: [
          {
            src: '/pwa-192x192.png',
            sizes: '192x192',
            type: 'image/png',
          },
          {
            src: '/pwa-512x512.png',
            sizes: '512x512',
            type: 'image/png',
          },
        ],
      },

      workbox: {
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts',
            },
          },
        ],
      },
      devOptions: {
        enabled: true,
      },
    }),
  ],
  // test: {
  //   environment: "jsdom",
  //   globals: true,
  //   setupFiles: ["./src/test/setup.ts"],
  //   include: ["src/**/*.{test,spec}.{ts,tsx}"],
  // },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
})



