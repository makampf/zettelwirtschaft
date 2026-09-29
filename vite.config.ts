/// <reference types="vitest/config" />
import { copyFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';

const require = createRequire(import.meta.url);

/**
 * Legt die Dateien für die Texterkennung (tesseract.js) neben die App nach dist/ocr/,
 * damit Fotos auch ohne fremdes CDN ausgelesen werden (GitHub Pages und eigener Server).
 */
function ocrDateien(): Plugin {
  return {
    name: 'ocr-dateien',
    apply: 'build',
    closeBundle() {
      const ziel = resolve('dist/ocr');
      const core = dirname(require.resolve('tesseract.js-core/package.json'));
      const sprache = join(dirname(require.resolve('@tesseract.js-data/deu/package.json')), '4.0.0_best_int');
      mkdirSync(join(ziel, 'core'), { recursive: true });
      mkdirSync(join(ziel, 'lang'), { recursive: true });
      copyFileSync(require.resolve('tesseract.js/dist/worker.min.js'), join(ziel, 'worker.min.js'));
      // Nur die LSTM-Varianten werden genutzt (Standard-Erkennungsmodus); welche, hängt vom Browser ab
      for (const f of ['tesseract-core-relaxedsimd-lstm.wasm.js', 'tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js']) {
        copyFileSync(join(core, f), join(ziel, 'core', f));
      }
      copyFileSync(join(sprache, 'deu.traineddata.gz'), join(ziel, 'lang', 'deu.traineddata.gz'));
    },
  };
}

// Der Build erzeugt eine einzige HTML-Datei (dist/index.html), die ohne Server
// per Doppelklick im Browser geöffnet werden kann, plus die OCR-Dateien in dist/ocr/.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile(), ocrDateien()],
  test: {
    environment: 'node',
  },
});
