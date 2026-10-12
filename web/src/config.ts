import { readFile } from 'node:fs/promises';

/** A user-defined cleanup action: tag the asset with `label`, then archive it. */
export interface ExtraButton {
  /** Button text, and the exact Immich tag name the button applies. */
  label: string;
  /** A lucide icon name, e.g. `archive` or `book-open`. */
  icon: string;
}

export interface AppConfig {
  immichApiBaseUrl: string;
  immichOriginAndPrefix: string;
  immichApiKey: string;
  webPassword: string;
  webHost: string;
  webPort: number;
  dataDir: string;
  extraButtons: ExtraButton[];
}

const MAX_EXTRA_BUTTONS = 8;
const MAX_BUTTON_LABEL_LENGTH = 48;
const BUTTON_ICON_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

/**
 * `EXTRA_BUTTONS` is a comma-separated list of `label:lucide-icon` pairs, for example
 * `Trips:plane,Family:users`. Each entry becomes a button in the cleanup tab that tags the asset with
 * its label and archives it. Parsing fails at startup so a typo cannot ship a half-broken toolbar.
 */
export function parseExtraButtons(raw: string): ExtraButton[] {
  const entries = raw
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
  if (entries.length > MAX_EXTRA_BUTTONS) {
    throw new Error(`EXTRA_BUTTONS accepts at most ${MAX_EXTRA_BUTTONS} buttons`);
  }

  const buttons: ExtraButton[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const separator = entry.lastIndexOf(':');
    const label = separator < 0 ? '' : entry.slice(0, separator).trim();
    const icon = separator < 0 ? '' : entry.slice(separator + 1).trim();
    if (!label || !icon) throw new Error(`EXTRA_BUTTONS entry "${entry}" must look like label:lucide-icon`);
    if (label.length > MAX_BUTTON_LABEL_LENGTH) {
      throw new Error(`EXTRA_BUTTONS label "${label}" is longer than ${MAX_BUTTON_LABEL_LENGTH} characters`);
    }
    if (/[\u0000-\u001f\u007f]/.test(label)) throw new Error(`EXTRA_BUTTONS label "${label}" contains control characters`);
    if (!BUTTON_ICON_PATTERN.test(icon)) {
      throw new Error(`EXTRA_BUTTONS icon "${icon}" must be a lucide icon name such as "archive" or "book-open"`);
    }
    const key = label.toLowerCase();
    if (seen.has(key)) throw new Error(`EXTRA_BUTTONS lists "${label}" twice`);
    seen.add(key);
    buttons.push({ label, icon });
  }
  return buttons;
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
  const extraButtons = parseExtraButtons(process.env.EXTRA_BUTTONS ?? '');

  return {
    immichApiBaseUrl: apiBaseUrl,
    immichOriginAndPrefix: originAndPrefix,
    immichApiKey,
    webPassword,
    webHost: process.env.WEB_HOST ?? '0.0.0.0',
    webPort,
    dataDir: process.env.WEB_DATA_DIR ?? '/data',
    extraButtons,
  };
}
