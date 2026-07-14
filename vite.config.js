import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Permite publicar la aplicación en cualquier subcarpeta, por ejemplo /planner/.
  base: './',
  plugins: [react()]
});
