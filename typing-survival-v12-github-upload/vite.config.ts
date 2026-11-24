import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages project sites use /<repository-name>/ as their URL base.
// Local npm run dev keeps / as its base.
export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES_BASE || '/',
});
