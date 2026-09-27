import { defineConfig } from 'vite';
import { resolve } from 'path';
import { readFileSync } from 'fs';

// Single source of truth for every version shown at runtime: manifest.json.
// Bump it there, run `npm run build`, and the injected badge follows.
const manifest = JSON.parse(
  readFileSync(resolve(__dirname, 'extensions/steam-store-helper/manifest.json'), 'utf8')
) as { version: string };

export default defineConfig({
  define: {
    __LUMA_VERSION__: JSON.stringify(manifest.version),
  },
  build: {
    lib: {
      entry: resolve(__dirname, 'extensions/steam-store-helper/src/main.ts'),
      formats: ['iife'],
      name: 'LumaForge',
      fileName: () => 'inject.js',
    },
    outDir: resolve(__dirname, 'extensions/steam-store-helper/dist'),
    emptyOutDir: true,
    minify: 'terser',
    sourcemap: false,
    rollupOptions: {
      output: { extend: true, inlineDynamicImports: true },
    },
  },
});
