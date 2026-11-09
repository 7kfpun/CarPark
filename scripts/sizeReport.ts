// Pure helpers for `npm run size`: chunk naming, budget limits and the report table.

export interface Chunk {
  /** Path under dist/, e.g. "assets/index-SmQQBtbV.js". */
  file: string;
  raw: number;
  gzip: number;
}

export interface Limit {
  raw: number;
  gzip: number;
}

export interface Budget {
  /** Limit for every chunk together (JS + CSS under dist/assets). */
  total: Limit;
  /** Limits by chunk name with the content hash stripped ("index.js", "vendor.js"). Unlisted chunks only count towards the total. */
  chunks: Record<string, Limit>;
}

/** "assets/index-SmQQBtbV.js" -> "index.js" (the hash is the last dash-separated part). */
export function chunkName(file: string): string {
  const base = file.slice(file.lastIndexOf('/') + 1);
  return base.replace(/-[A-Za-z0-9_-]{8}(\.[a-z]+)$/, '$1');
}

/** Today's size plus a margin, rounded up to the next 100 bytes. */
export function withHeadroom(size: number, margin = 0.1): number {
  return Math.ceil((size * (1 + margin)) / 100) * 100;
}

export function sum(chunks: Chunk[]): Chunk {
  return {
    file: 'total',
    raw: chunks.reduce((a, c) => a + c.raw, 0),
    gzip: chunks.reduce((a, c) => a + c.gzip, 0),
  };
}

/** A budget at today's size plus the margin, for the `--init` run. */
export function makeBudget(chunks: Chunk[], margin = 0.1): Budget {
  const lim = (c: Chunk): Limit => ({ raw: withHeadroom(c.raw, margin), gzip: withHeadroom(c.gzip, margin) });
  const out: Budget = { total: lim(sum(chunks)), chunks: {} };
  for (const c of chunks) out.chunks[chunkName(c.file)] = lim(c);
  return out;
}

/** One message per exceeded limit; empty when the build is within budget. */
export function budgetProblems(chunks: Chunk[], budget: Budget): string[] {
  const out: string[] = [];
  const over = (label: string, c: Chunk, l: Limit): void => {
    if (c.raw > l.raw) out.push(`${label}: raw ${c.raw} B exceeds budget ${l.raw} B`);
    if (c.gzip > l.gzip) out.push(`${label}: gzip ${c.gzip} B exceeds budget ${l.gzip} B`);
  };
  over('total', sum(chunks), budget.total);
  for (const c of chunks) {
    const l = budget.chunks[chunkName(c.file)];
    if (l) over(chunkName(c.file), c, l);
  }
  return out;
}

const kb = (n: number): string => (n / 1024).toFixed(1).padStart(8);

/** Markdown table, ready to paste into a PR. */
export function sizeTable(chunks: Chunk[], budget?: Budget): string {
  const rows = [...chunks, sum(chunks)];
  const lines = ['| chunk | raw KiB | gzip KiB | budget gzip KiB |', '| --- | ---: | ---: | ---: |'];
  for (const c of rows) {
    const l = c.file === 'total' ? budget?.total : budget?.chunks[chunkName(c.file)];
    lines.push(
      `| ${c.file === 'total' ? 'total' : chunkName(c.file)} | ${kb(c.raw)} | ${kb(c.gzip)} | ${l ? kb(l.gzip) : '       -'} |`,
    );
  }
  return lines.join('\n');
}
