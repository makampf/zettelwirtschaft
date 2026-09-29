import { describe, expect, it } from 'vitest';
import { startState } from './defaults';
import { BACKUP_FORMAT, backupLesen } from './backup';

const datei = (format: string) => new Blob([JSON.stringify({ format, erstelltAm: '2026-01-01', state: startState(), dateien: {} })]);

describe('Sicherung einlesen', () => {
  it('liest das aktuelle Format', async () => {
    expect((await backupLesen(datei(BACKUP_FORMAT))).state.personen).toHaveLength(3);
  });

  it('lehnt fremde Dateien ab', async () => {
    await expect(backupLesen(datei('irgendwas'))).rejects.toThrow('keine gültige Sicherung');
  });
});
