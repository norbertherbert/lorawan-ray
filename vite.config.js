import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Relative assets work both at / locally and under /repository-name/ on GitHub Pages.
  base: './',
  plugins: [react()],
});
