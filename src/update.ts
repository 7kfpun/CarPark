// Version check: decides whether the running build must or may be replaced.

/** What the running build knows about itself (stamped in at build time). */
export interface LocalBuild {
  version: string;
  build: string;
}

/** Contents of version.json, written next to index.html on every build. */
export interface RemoteVersion extends LocalBuild {
  /** Builds older than this are blocked until they update. Controlled by version-policy.json. */
  minVersion: string | null;
}

export type UpdateKind = 'none' | 'optional' | 'required';

/** Parses "1.2.3" into numbers; null when it is not a plain dotted version. */
export function parseVersion(v: unknown): number[] | null {
  if (typeof v !== 'string' || !/^\d+(\.\d+){0,3}$/.test(v)) return null;
  return v.split('.').map(Number);
}

/** Negative when a < b, 0 when equal, positive when a > b. Missing parts count as 0. */
export function compareVersions(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Validates untrusted JSON from the server; null when it is not usable. */
export function parseRemote(raw: unknown): RemoteVersion | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (!parseVersion(o.version) || typeof o.build !== 'string' || !o.build) return null;
  const min = o.minVersion;
  if (min !== undefined && min !== null && !parseVersion(min)) return null;
  return { version: o.version as string, build: o.build, minVersion: typeof min === 'string' ? min : null };
}

export function decideUpdate(local: LocalBuild, remote: RemoteVersion): UpdateKind {
  const lv = parseVersion(local.version);
  const rv = parseVersion(remote.version);
  if (!lv || !rv) return 'none';
  const min = remote.minVersion ? parseVersion(remote.minVersion) : null;
  if (min && compareVersions(lv, min) < 0) return 'required';
  // A stale cached file older than what we run is never an update.
  if (compareVersions(rv, lv) < 0) return 'none';
  return remote.build !== local.build ? 'optional' : 'none';
}

/** Fetches version.json and decides. Any failure (offline, bad JSON, timeout) means 'none': never block play. */
export async function checkForUpdate(
  local: LocalBuild,
  url: string,
  timeoutMs = 5000,
  fetchFn: typeof fetch = fetch,
): Promise<UpdateKind> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchFn(`${url}${url.includes('?') ? '&' : '?'}t=${Date.now()}`, {
      cache: 'no-store',
      signal: ctl.signal,
    });
    if (!res.ok) return 'none';
    const remote = parseRemote(await res.json());
    return remote ? decideUpdate(local, remote) : 'none';
  } catch {
    return 'none';
  } finally {
    clearTimeout(timer);
  }
}
