// Erstellt dist/THIRD-PARTY-LICENSES.txt mit den Lizenztexten aller Bibliotheken,
// die in die App eingebaut bzw. mit dem Server ausgeliefert werden (inkl. ihrer Abhängigkeiten).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const WURZELN = ['react', 'react-dom', 'pdfjs-dist', 'tesseract.js', '@tesseract.js-data/deu', 'hono', '@hono/node-server', 'pg'];

function paketVerzeichnis(name, von) {
  try {
    return dirname(require.resolve(`${name}/package.json`, { paths: [von] }));
  } catch {
    // Pakete ohne exportierte package.json: im node_modules-Baum suchen
    for (let d = von; ; d = dirname(d)) {
      const kandidat = join(d, 'node_modules', name);
      if (existsSync(join(kandidat, 'package.json'))) return kandidat;
      if (dirname(d) === d) return null;
    }
  }
}

const gesehen = new Map();
function sammle(name, von) {
  const dir = paketVerzeichnis(name, von);
  if (!dir) return;
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const key = `${pkg.name}@${pkg.version}`;
  if (gesehen.has(key)) return;
  const lizenzDatei = readdirSync(dir).find((f) => /^(licen[cs]e|copying|notice)(\..*)?$/i.test(f));
  gesehen.set(key, { pkg, text: lizenzDatei ? readFileSync(join(dir, lizenzDatei), 'utf8').trim() : null });
  for (const dep of Object.keys(pkg.dependencies ?? {})) sammle(dep, dir);
}
for (const w of WURZELN) sammle(w, process.cwd());

const teile = [...gesehen.values()]
  .sort((a, b) => a.pkg.name.localeCompare(b.pkg.name))
  .map(({ pkg, text }) => {
    const lizenz = typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'siehe Paket';
    return `${'='.repeat(78)}\n${pkg.name} ${pkg.version} — ${lizenz}\n${pkg.homepage ?? ''}\n${'='.repeat(78)}\n\n${text ?? `Lizenz: ${lizenz}`}\n`;
  });

writeFileSync(
  'dist/THIRD-PARTY-LICENSES.txt',
  `Zettelwirtschaft – Lizenzen der mitgelieferten Bibliotheken\n\nDie Zettelwirtschaft selbst steht unter der GNU AGPL v3.0 (siehe LICENSE).\n\n${teile.join('\n')}`,
);
console.log(`THIRD-PARTY-LICENSES.txt: ${gesehen.size} Pakete`);
