import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { precacheList, serviceWorkerSource } from './scripts/serviceWorker';
import { buildVersion } from './scripts/version';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
// version-policy.json is the lever for forcing an update: raise minVersion and deploy.
const policy = JSON.parse(readFileSync(new URL('./version-policy.json', import.meta.url), 'utf8')) as {
  minVersion?: string;
};

function gitSha(): string | undefined {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    return undefined;
  }
}

const sha = gitSha();
const version = buildVersion(pkg.version, sha); // "<semver>+<sha>", shown in the UI
const build = (sha ?? '').trim().slice(0, 7) || 'unknown';

// Writes version.json next to index.html; the running game polls it (see src/update.ts).
function versionFile(): Plugin {
  return {
    name: 'version-json',
    generateBundle() {
      const info = { version: pkg.version, build, minVersion: policy.minVersion ?? null };
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(info) + '\n' });
    },
  };
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

// Writes dist/sw.js after everything else is in dist (public files included), precaching all of it.
function serviceWorker(): Plugin {
  let outDir = 'dist';
  return {
    name: 'service-worker',
    apply: 'build',
    configResolved(c) {
      outDir = c.build.outDir;
    },
    closeBundle() {
      const files = walk(outDir).map((p) => relative(outDir, p).split('\\').join('/'));
      const list = precacheList(files, []);
      writeFileSync(join(outDir, 'sw.js'), serviceWorkerSource(build, list));
    },
  };
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_SEMVER__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(build),
  },
  plugins: [versionFile(), serviceWorker()],
  build: { chunkSizeWarningLimit: 800 },
});
