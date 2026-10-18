import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Base '/admin/' : le dashboard est servi par le backend sous https://<api>/admin/
  base: '/admin/',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../server/public/admin', emptyOutDir: true },
  server: {
    port: 5173,
  },
});

