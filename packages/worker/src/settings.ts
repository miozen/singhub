import type { GenerationSettings, GenerationSettingsPayload, RegionCode } from '../../shared/src/types';
import { REGIONS, isSafeHttpUrl } from '../../shared/src/validators';

const GENERATION_SETTINGS_KEY = 'generation';
export const DNS_OUTBOUND_TAG = '📡 dns-out';
export const MANUAL_SELECTOR_OUTBOUND_TAG = '🍭 手动选择';

export const DEFAULT_GENERATION_SETTINGS: GenerationSettings = {
  region_keywords: {
    HK: ['HK', 'HKG', 'Hong Kong', '香港', '港'],
    TW: ['TW', 'TWN', 'Taiwan', '台湾', '台灣', '台'],
    SG: ['SG', 'SGP', 'Singapore', '新加坡', '狮城', '獅城'],
    JP: ['JP', 'JPN', 'Japan', '日本', '东京', '東京'],
    US: ['US', 'USA', 'United States', 'America', '美国', '美國', '洛杉矶', '洛杉磯']
  },
  banned_pattern: '过期|剩余|网址',
  subscription_user_agent: 'Mozilla/5.0 (Clash)',
  fetch_timeout_ms: 10000,
  max_subscription_bytes: 5000000,
  urltest: {
    url: 'https://www.gstatic.com/generate_204',
    interval: '3m',
    tolerance: 150
  },
  dns_urltest: {
    enabled: false,
    keywords: ['HK', 'HKG', 'Hong Kong', '香港'],
    url: 'https://www.gstatic.com/generate_204',
    interval: '3m',
    tolerance: 150
  },
  manual_selector: {
    enabled: false,
    keywords: []
  }
};

type SettingsRow = { key: string; value_json: string; updated_at?: string };

export async function ensureSettingsTable(db: D1Database) {
  const existing = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'"
  ).first<{ name: string }>();
  if (existing) return;

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
}

function uniqueStrings(value: unknown, fallback: string[], limit = 30) {
  const seen = new Set<string>();
  const source = Array.isArray(value) ? value : fallback;
  const result = source
    .map((item) => String(item || '').trim())
    .filter((item) => item && !seen.has(item) && seen.add(item))
    .slice(0, limit);
  return result.length ? result : fallback;
}

function optionalUniqueStrings(value: unknown, limit = 30) {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim())
    .filter((item) => item && !seen.has(item) && seen.add(item))
    .slice(0, limit);
}

function boundedInteger(value: unknown, fallback: number, min: number, max: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.trunc(parsed)));
}

function normalizePattern(value: unknown) {
  const pattern = String(value || DEFAULT_GENERATION_SETTINGS.banned_pattern).trim();
  try {
    new RegExp(pattern, 'i');
    return pattern;
  } catch {
    return DEFAULT_GENERATION_SETTINGS.banned_pattern;
  }
}

export function normalizeGenerationSettings(input: Partial<GenerationSettingsPayload> = {}): GenerationSettings {
  const regionKeywords = Object.fromEntries(REGIONS.map((region) => [
    region,
    uniqueStrings(input.region_keywords?.[region as RegionCode], DEFAULT_GENERATION_SETTINGS.region_keywords[region as RegionCode])
  ])) as Record<RegionCode, string[]>;
  const url = String(input.urltest?.url || DEFAULT_GENERATION_SETTINGS.urltest.url).trim();
  const interval = String(input.urltest?.interval || DEFAULT_GENERATION_SETTINGS.urltest.interval).trim();
  const dnsUrl = String(input.dns_urltest?.url || DEFAULT_GENERATION_SETTINGS.dns_urltest.url).trim();
  const dnsInterval = String(input.dns_urltest?.interval || DEFAULT_GENERATION_SETTINGS.dns_urltest.interval).trim();
  const userAgent = String(input.subscription_user_agent || DEFAULT_GENERATION_SETTINGS.subscription_user_agent).trim();

  return {
    region_keywords: regionKeywords,
    banned_pattern: normalizePattern(input.banned_pattern),
    subscription_user_agent: userAgent.slice(0, 160) || DEFAULT_GENERATION_SETTINGS.subscription_user_agent,
    fetch_timeout_ms: boundedInteger(input.fetch_timeout_ms, DEFAULT_GENERATION_SETTINGS.fetch_timeout_ms, 1000, 60000),
    max_subscription_bytes: boundedInteger(input.max_subscription_bytes, DEFAULT_GENERATION_SETTINGS.max_subscription_bytes, 100000, 20000000),
    urltest: {
      url: isSafeHttpUrl(url) ? url : DEFAULT_GENERATION_SETTINGS.urltest.url,
      interval: interval.slice(0, 20) || DEFAULT_GENERATION_SETTINGS.urltest.interval,
      tolerance: boundedInteger(input.urltest?.tolerance, DEFAULT_GENERATION_SETTINGS.urltest.tolerance, 0, 5000)
    },
    dns_urltest: {
      enabled: input.dns_urltest?.enabled === true,
      keywords: uniqueStrings(input.dns_urltest?.keywords, DEFAULT_GENERATION_SETTINGS.dns_urltest.keywords),
      url: isSafeHttpUrl(dnsUrl) ? dnsUrl : DEFAULT_GENERATION_SETTINGS.dns_urltest.url,
      interval: dnsInterval.slice(0, 20) || DEFAULT_GENERATION_SETTINGS.dns_urltest.interval,
      tolerance: boundedInteger(input.dns_urltest?.tolerance, DEFAULT_GENERATION_SETTINGS.dns_urltest.tolerance, 0, 5000)
    },
    manual_selector: {
      enabled: input.manual_selector?.enabled === true,
      keywords: optionalUniqueStrings(input.manual_selector?.keywords)
    }
  };
}

export async function readGenerationSettings(db: D1Database) {
  await ensureSettingsTable(db);
  const row = await db.prepare('SELECT key, value_json, updated_at FROM settings WHERE key = ?')
    .bind(GENERATION_SETTINGS_KEY).first<SettingsRow>();
  if (!row) return { ...DEFAULT_GENERATION_SETTINGS, updated_at: null };
  try {
    return { ...normalizeGenerationSettings(JSON.parse(row.value_json)), updated_at: row.updated_at || null };
  } catch {
    return { ...DEFAULT_GENERATION_SETTINGS, updated_at: row.updated_at || null };
  }
}

export async function updateGenerationSettings(db: D1Database, payload: GenerationSettingsPayload) {
  await ensureSettingsTable(db);
  const settings = normalizeGenerationSettings(payload);
  await db.prepare(`
    INSERT INTO settings (key, value_json, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(key) DO UPDATE SET
      value_json = excluded.value_json,
      updated_at = CURRENT_TIMESTAMP
  `).bind(GENERATION_SETTINGS_KEY, JSON.stringify(settings)).run();
  return readGenerationSettings(db);
}
