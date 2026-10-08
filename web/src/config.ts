import { readFile } from 'node:fs/promises';

export interface AppConfig {
  immichApiBaseUrl: string;
  immichOriginAndPrefix: string;
  immichApiKey: string;
  webPassword: string;
  webHost: string;
  webPort: number;
  dataDir: string;
}

async function readSecret(name: string): Promise<string> {
  const value = process.env[name];
  const file = process.env[`${name}_FILE`];
  if (value && file) {
    throw new Error(`Set only one of ${name} or ${name}_FILE`);
  }
  if (file) {
    return (await readFile(file, 'utf8')).replace(/\r?\n$/, '');
  }
  return value ?? '';
}

function normalizeImmichUrl(raw: string): { apiBaseUrl: string; originAndPrefix: string } {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('IMMICH_URL must be a valid absolute URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('IMMICH_URL must use HTTP(S) and contain no credentials, query, or fragment');
  }
  const prefix = parsed.pathname.replace(/\/+$/, '').replace(/\/api$/i, '');
  const originAndPrefix = `${parsed.origin}${prefix}`;
  return { originAndPrefix, apiBaseUrl: `${originAndPrefix}/api` };
}

export async function loadConfig(): Promise<AppConfig> {
  const immichUrl = process.env.IMMICH_URL ?? '';
  const immichApiKey = await readSecret('IMMICH_API_KEY');
  const webPassword = await readSecret('WEB_PASSWORD');
  if (!immichUrl) throw new Error('IMMICH_URL is required');
  if (!immichApiKey) throw new Error('IMMICH_API_KEY or IMMICH_API_KEY_FILE is required');
  if (webPassword.length < 12) throw new Error('WEB_PASSWORD or WEB_PASSWORD_FILE must contain at least 12 characters');

  const { apiBaseUrl, originAndPrefix } = normalizeImmichUrl(immichUrl);
  const webPort = Number(process.env.WEB_PORT ?? '3000');
  if (!Number.isInteger(webPort) || webPort < 1 || webPort > 65535) {
    throw new Error('WEB_PORT must be an integer from 1 to 65535');
  }

  return {
    immichApiBaseUrl: apiBaseUrl,
    immichOriginAndPrefix: originAndPrefix,
    immichApiKey,
    webPassword,
    webHost: process.env.WEB_HOST ?? '0.0.0.0',
    webPort,
    dataDir: process.env.WEB_DATA_DIR ?? '/data',
  };
}
