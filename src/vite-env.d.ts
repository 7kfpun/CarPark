/// <reference types="vite/client" />

/** "<package.json version>+<short git sha>", injected at build time by vite.config.ts. */
declare const __APP_VERSION__: string;
/** Plain package.json version, used by the update check. */
declare const __APP_SEMVER__: string;
/** Short git sha of the build. */
declare const __APP_BUILD__: string;
