import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Islands build: compiles src/islands.jsx -> assets/islands.js (fixed name,
// cache-busted with the site's ?v= workflow like other assets).
// The static HTML pages are NOT processed by Vite, so SEO content,
// the post-pull refresh pipeline and push-to-deploy stay untouched.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'assets',
    emptyOutDir: false,
    rollupOptions: {
      input: 'src/islands.tsx',
      output: {
        entryFileNames: 'islands.js',
        format: 'iife',
        name: 'NairaviewIslands',
      },
    },
    minify: true,
  },
});
