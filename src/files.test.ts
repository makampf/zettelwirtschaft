import { describe, expect, it } from 'vitest';
import { dateiHash, gleicheDatei } from './files';

describe('Dateien', () => {
  it('berechnet SHA-256 des Inhalts', async () => {
    expect(await dateiHash(new Blob(['abc']))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('vergleicht über die Prüfsumme, ohne Prüfsumme über Name und Größe', () => {
    const meta = { id: '1', name: 'beleg.pdf', type: 'application/pdf', size: 3, hash: 'aaa' };
    expect(gleicheDatei(meta, { name: 'anders.pdf', size: 3 }, 'aaa')).toBe(true);
    expect(gleicheDatei(meta, { name: 'beleg.pdf', size: 3 }, 'bbb')).toBe(false);
    const alt = { ...meta, hash: undefined };
    expect(gleicheDatei(alt, { name: 'beleg.pdf', size: 3 }, 'bbb')).toBe(true);
    expect(gleicheDatei(alt, { name: 'beleg.pdf', size: 4 }, 'bbb')).toBe(false);
  });
});
