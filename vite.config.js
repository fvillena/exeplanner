import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // Use root-relative assets so client-side routes such as /prescriber load correctly.
  base: '/',
  plugins: [react()]
});
