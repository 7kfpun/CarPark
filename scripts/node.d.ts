// The few Node APIs the scripts use (the project compiles with no @types/node).
declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function readFileSync(path: string): Uint8Array;
  export function statSync(path: string): { isFile(): boolean };
  export function writeFileSync(path: string, data: string): void;
  export function mkdirSync(path: string, options: { recursive: boolean }): void;
  export function readdirSync(path: string): string[];
  export function rmSync(path: string, options: { force: boolean }): void;
  export function existsSync(path: string): boolean;
}
declare module 'node:zlib' {
  export function gzipSync(data: Uint8Array, options?: { level?: number }): Uint8Array;
}
declare const process: { argv: string[]; exit(code?: number): never };
