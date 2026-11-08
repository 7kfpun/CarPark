import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
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

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __APP_SEMVER__: JSON.stringify(pkg.version),
    __APP_BUILD__: JSON.stringify(build),
  },
  plugins: [versionFile()],
  build: { chunkSizeWarningLimit: 800 },
});
