import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  // Base '/artisants-admin/' pour GitHub Pages (https://kalonji086.github.io/artisants-admin/)
  base: '/artisants-admin/',
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
});
