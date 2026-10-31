import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Base '/admin/' : le dashboard est servi par le backend sous https://<api>/admin/
  base: '/admin/',
  envDir: '..',
  plugins: [react(), tailwindcss()],
  resolve: { extensions: ['.tsx', '.ts', '.jsx', '.js', '.mjs', '.mts', '.json'] },
  build: {
    outDir: '../server/public/admin',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('node_modules/recharts')) return 'recharts';
          if (id.includes('node_modules/@supabase')) return 'supabase';
          if (id.includes('node_modules/react')) return 'react-vendor';
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api/v1': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
});
