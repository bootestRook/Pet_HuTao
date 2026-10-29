import { networkInterfaces } from 'node:os';

function origin(value: string): string {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('PUBLIC_URL / ALLOWED_ORIGINS must be HTTP(S) origins without path or credentials.');
  }
  return url.origin;
}
export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be 1–65535.');
  return {
    host: env.HOST || '0.0.0.0', port,
    publicUrl: env.PUBLIC_URL ? origin(env.PUBLIC_URL) : null,
    allowedOrigins: (env.ALLOWED_ORIGINS || '').split(',').filter(Boolean).map(s => origin(s.trim()))
  };
}
export type AppConfig = ReturnType<typeof readConfig>;
export function originAllowed(value: string | undefined, host: string | undefined, config: AppConfig) {
  if (!value) return true; // SDK/CLI clients do not send a browser Origin header.
  try {
    const parsed = new URL(value);
    if (!['http:', 'https:'].includes(parsed.protocol)) return false;
    return parsed.origin === config.publicUrl || config.allowedOrigins.includes(parsed.origin) || parsed.host === host;
  } catch { return false; }
}
export function localUrls(port: number) {
  return [...new Set(Object.entries(networkInterfaces())
    .filter(([name]) => !/virtual|vethernet|docker|wsl|loopback/i.test(name))
    .flatMap(([, addresses]) => (addresses ?? []).filter(a => a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.')).map(a => `http://${a.address}:${port}`)))];
}
