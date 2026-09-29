import type { Worker as OcrWorker } from 'tesseract.js';
import { zeilenAusPdf, type TextTeil } from './pdfLines';
// Liest den Text eines Belegs – vollständig im Browser, nichts verlässt das Gerät.
// PDFs mit Textebene werden direkt gelesen; Fotos und gescannte PDFs per Texterkennung (OCR).

export type Fortschritt = (meldung: string) => void;

/** Höchstens so viele Seiten auswerten – die Angaben stehen fast immer vorne bzw. auf der ersten Seite. */
const MAX_SEITEN = 3;

let pdfjsLaden: Promise<typeof import('pdfjs-dist')> | undefined;

async function pdfjs() {
  pdfjsLaden ??= (async () => {
    const lib = await import('pdfjs-dist');
    const { default: PdfWorker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?worker&inline');
    lib.GlobalWorkerOptions.workerPort = new PdfWorker();
    return lib;
  })();
  return pdfjsLaden;
}

let ocrWorker: Promise<OcrWorker> | undefined;

function ocrPfade() {
  // Über HTTP(S) (eigener Server, GitHub Pages): Programm und Sprachdaten liegen neben der App in ocr/.
  // Als lokale Datei geöffnet dürfen Worker nichts nachladen – dann vom CDN.
  if (import.meta.env.DEV || !location.protocol.startsWith('http')) return {};
  const basis = new URL('ocr/', location.href).href;
  return { workerPath: `${basis}worker.min.js`, corePath: `${basis}core/`, langPath: `${basis}lang` };
}

async function ocr(bild: Blob | HTMLCanvasElement, fortschritt?: Fortschritt): Promise<string> {
  ocrWorker ??= (async () => {
    fortschritt?.('Texterkennung wird geladen …');
    const { createWorker } = await import('tesseract.js');
    return createWorker('deu', 1, {
      ...ocrPfade(),
      logger: (m) => {
        if (m.status === 'recognizing text') fortschritt?.(`Texterkennung … ${Math.round(m.progress * 100)} %`);
      },
    });
  })();
  const worker = await ocrWorker.catch((e) => {
    ocrWorker = undefined;
    throw e;
  });
  fortschritt?.('Texterkennung läuft …');
  const { data } = await worker.recognize(bild);
  return data.text;
}

async function textAusPdf(datei: Blob, fortschritt?: Fortschritt): Promise<string> {
  fortschritt?.('PDF wird gelesen …');
  const lib = await pdfjs();
  const pdf = await lib.getDocument({ data: new Uint8Array(await datei.arrayBuffer()) }).promise;
  const seiten = Math.min(pdf.numPages, MAX_SEITEN);
  let text = '';
  for (let i = 1; i <= seiten; i++) {
    const seite = await pdf.getPage(i);
    const inhalt = await seite.getTextContent();
    text += zeilenAusPdf(inhalt.items as TextTeil[]) + '\n';
  }
  if (text.replace(/\s/g, '').length >= 40) return text;

  // Gescanntes PDF ohne Textebene: Seiten rendern und per OCR lesen
  let ocrText = '';
  for (let i = 1; i <= seiten; i++) {
    const seite = await pdf.getPage(i);
    const ansicht = seite.getViewport({ scale: 2 });
    const canvas = document.createElement('canvas');
    canvas.width = ansicht.width;
    canvas.height = ansicht.height;
    await seite.render({ canvas, viewport: ansicht }).promise;
    ocrText += (await ocr(canvas, fortschritt)) + '\n';
  }
  return ocrText;
}

export function istPdf(datei: File): boolean {
  return datei.type === 'application/pdf' || /\.pdf$/i.test(datei.name);
}

export function istLesbar(datei: File): boolean {
  return istPdf(datei) || datei.type.startsWith('image/');
}

/** Liefert den Text eines Belegs (PDF oder Bild). */
export async function textAusDatei(datei: File, fortschritt?: Fortschritt): Promise<string> {
  if (istPdf(datei)) return textAusPdf(datei, fortschritt);
  if (datei.type.startsWith('image/')) return ocr(datei, fortschritt);
  throw new Error('Nur PDF-Dateien und Bilder können ausgelesen werden.');
}
