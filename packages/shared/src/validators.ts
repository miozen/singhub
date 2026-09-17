export const TEMPLATE_ID_RE = /^[a-zA-Z0-9_-]+$/;

export function isValidTemplateId(id: unknown): id is string {
  return typeof id === 'string' && TEMPLATE_ID_RE.test(id);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function ensureJsonString(raw: string) {
  JSON.parse(raw);
  return raw;
}

export function isSafeHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function cleanRegions(value: unknown) {
  const seen = new Set<string>();
  return (Array.isArray(value) ? value : [])
    .map((item) => String(item || '').trim().toUpperCase())
    .filter((item) => /^[A-Z0-9_-]{2,16}$/.test(item) && !seen.has(item) && seen.add(item));
}
export function isValidJsonObjectString(value: unknown) {
  if (value === undefined || value === null || value === '') return true;
  if (typeof value !== 'string') return false;
  try {
    const parsed = JSON.parse(value);
    return Boolean(parsed && typeof parsed === 'object' && !Array.isArray(parsed));
  } catch {
    return false;
  }
}
