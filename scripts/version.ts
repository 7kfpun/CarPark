// Build version helpers shared by vite.config.ts and scripts/validate.ts.
export function buildVersion(pkgVersion: string, sha: string | undefined): string {
  const short = (sha ?? '').trim().slice(0, 7);
  return `${pkgVersion}+${short || 'unknown'}`;
}
