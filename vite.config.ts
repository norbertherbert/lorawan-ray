import tailwindcss from '@tailwindcss/vite';
import flowbiteReact from 'flowbite-react/plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  // Relative assets work both at / locally and under /repository-name/ on GitHub Pages.
  base: './',
  plugins: [react(), tailwindcss(), flowbiteReact()],
});
