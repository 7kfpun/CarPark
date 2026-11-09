// Regenerates docs/LEVELS.md and docs/maps/*.svg from src/levels.ts. Run: npm run maps
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { LEVELS } from '../src/levels';
import { renderMaps } from './mapsRender';

const files = renderMaps(LEVELS);
mkdirSync('docs/maps', { recursive: true });
for (const f of readdirSync('docs/maps')) {
  if (f.endsWith('.svg') && !files.has(`docs/maps/${f}`)) rmSync(`docs/maps/${f}`, { force: true });
}
for (const [path, content] of files) writeFileSync(path, content);
console.log(`Wrote ${files.size} files (docs/LEVELS.md and ${files.size - 1} maps)`);
