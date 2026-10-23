import tailwindcss from '@tailwindcss/vite'

// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: '2025-07-15',
  devtools: { enabled: true },
  modules: ['shadcn-nuxt'],
  css: ['~/assets/css/tailwind.css'],
  vite: {
    plugins: [tailwindcss()],
  },
  shadcn: {
    prefix: '',
    componentDir: '@/components/ui',
  },
  // Server-only: the browser talks to /api/* on this app, which proxies to the services.
  // Override with NUXT_CUSTOMER_SERVICE_URL / NUXT_PAYMENT_SERVICE_URL.
  runtimeConfig: {
    customerServiceUrl: 'http://localhost:4001',
    paymentServiceUrl: 'http://localhost:4002',
    public: {
      // One timezone for server and browser rendering, so SSR and hydration show the same times.
      timeZone: 'Asia/Phnom_Penh',
    },
  },
  app: {
    head: {
      title: 'Mobile Bank Console',
      htmlAttrs: { lang: 'en' },
    },
  },
})
