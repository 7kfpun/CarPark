import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { version: string };
// version-policy.json is the lever for forcing an update: raise minVersion and deploy.
const policy = JSON.parse(readFileSync('version-policy.json', 'utf8')) as { minVersion?: string };

function gitSha(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

const build = gitSha();

// Writes version.json next to index.html; the running game polls it (see src/update.ts).
const versionFile = (): Plugin => ({
  name: 'version-file',
  generateBundle() {
    const info = { version: pkg.version, build, minVersion: policy.minVersion ?? null };
    this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify(info) + '\n' });
  },
});

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(build),
  },
  plugins: [versionFile()],
  build: { chunkSizeWarningLimit: 800 },
});
