/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Der Build erzeugt eine einzige HTML-Datei (dist/index.html), die ohne Server
// per Doppelklick im Browser geöffnet werden kann.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  test: {
    environment: 'node',
  },
});
