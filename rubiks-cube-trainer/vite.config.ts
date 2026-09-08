import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the built page works from a subdirectory - which
  // is where GitHub Pages puts a project site.
  base: './',
  build: { outDir: 'dist', sourcemap: true },
});
