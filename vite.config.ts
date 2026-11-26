import { defineConfig } from 'vite';

export default defineConfig({
  server: { proxy: { '/api': 'http://127.0.0.1:3001' } },
  build: {
    // GitHub Pages is generated as a pair of self-contained HTML files.
    // Keep the lazy portal routes in the main bundle so build-pages can
    // safely inline the application without leaving chunk requests behind.
    rolldownOptions: { output: { codeSplitting: false } },
  },
});
