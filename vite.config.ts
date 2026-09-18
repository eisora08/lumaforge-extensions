import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig({
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
