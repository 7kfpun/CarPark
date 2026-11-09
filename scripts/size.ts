// Prints the built bundle size (raw and gzip, per chunk) and fails when size-budget.json is exceeded.
// Run after a build: npm run build && npm run size. `npm run size -- --init` rewrites the budget (current size + 10%).
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { budgetProblems, makeBudget, sizeTable, type Budget, type Chunk } from './sizeReport';

// Paths are relative to the repo root (npm runs this from there; the script is piped to node, so import.meta.url is not usable).
const DIST = 'dist/assets';
const BUDGET = 'size-budget.json';

if (!existsSync(DIST)) {
  console.error('dist/assets not found: run `npm run build` first');
  process.exit(1);
}

const chunks: Chunk[] = readdirSync(DIST)
  .filter((f) => /\.(js|css)$/.test(f) && statSync(`${DIST}/${f}`).isFile())
  .sort()
  .map((f) => {
    const buf = readFileSync(`${DIST}/${f}`);
    return { file: `assets/${f}`, raw: buf.length, gzip: gzipSync(buf, { level: 9 }).length };
  });

if (process.argv.includes('--init')) {
  writeFileSync(BUDGET, JSON.stringify(makeBudget(chunks), null, 2) + '\n');
  console.log('Wrote size-budget.json');
}

const budget = JSON.parse(readFileSync(BUDGET, 'utf8')) as Budget;
console.log(sizeTable(chunks, budget));
const problems = budgetProblems(chunks, budget);
for (const p of problems) console.error(`over budget: ${p}`);
if (problems.length) {
  console.error(
    'Raise size-budget.json only on purpose (`npm run size -- --init` resets it to the current size + 10%).',
  );
  process.exit(1);
}
