import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Family Hub — Nhắc việc gia đình',
        short_name: 'Family Hub',
        description: 'Nhắc việc hàng ngày, giỗ chạp, sinh nhật và theo dõi học tập của con',
        lang: 'vi',
        theme_color: '#4f46e5',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // API không cache — dữ liệu nhắc việc phải luôn tươi.
        navigateFallbackDenylist: [/^\/trpc/],
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        // handler cho push + notificationclick; file JS thuần ở public/
        importScripts: ['/push-handler.js'],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/trpc': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
  // `vite preview` dùng cấu hình proxy riêng — cần cho việc thử Web Push
  // trên bản build thật, vì service worker không chạy ở chế độ dev.
  preview: {
    port: 4173,
    proxy: {
      '/trpc': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
