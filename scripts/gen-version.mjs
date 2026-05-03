import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const dir = dirname(fileURLToPath(import.meta.url));
const root = resolve(dir, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf-8'));

const now = new Date();
const releaseDate = `${now.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })} a las ${now.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit', hour12: true })}`;

const versionInfo = {
  name: pkg.name,
  version: pkg.version,
  environment: process.env.NODE_ENV || 'development',
  releaseDate,
  timestamp: now.toISOString(),
  nodeVersion: process.version,
};

const outDir = resolve(root, 'public', 'assets');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, 'version.json'), JSON.stringify(versionInfo, null, 2), 'utf-8');
console.log(`✅ version.json generado en ${root.split('/').pop()}/public/assets/`);
