import type { RegionDefinition, SubscriptionPayload, SubscriptionTestReport } from '../../shared/src/types';
import { cleanRegions } from '../../shared/src/validators';
import { getSubscriptionById, getSubscriptionList, type SubscriptionRow } from './db';

const STRUCTURAL_TYPES = new Set(['selector', 'urltest', 'direct', 'block', 'dns']);
const DEFAULT_BANNED_PATTERN = '过期|剩余|网址';

function toBase64Url(bytes: Uint8Array) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64Url(input: string) {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((input.length + 3) % 4);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function encryptionKey(secret: string) {
  const material = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`subscription-url:${secret}`));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptSubscriptionUrl(url: string, secret: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await encryptionKey(secret);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(url));
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(encrypted))}`;
}

export async function decryptSubscriptionUrl(value: string, secret: string) {
  const [ivPart, encryptedPart] = value.split('.');
  if (!ivPart || !encryptedPart) throw new Error('subscription_decryption_failed');
  const key = await encryptionKey(secret);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64Url(ivPart) }, key, fromBase64Url(encryptedPart));
  return new TextDecoder().decode(decrypted);
}

async function ensureSubscriptionTable(db: D1Database) {
  const existing = await db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'subscriptions'"
  ).first<{ name: string }>();
  if (existing) return;

  await db.prepare(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      url_encrypted TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
      allowed_regions_json TEXT NOT NULL DEFAULT '[]',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `).run();
  await db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_subscriptions_created_at
    ON subscriptions(created_at DESC)
  `).run();
}

function parseRegions(raw: string) {
  try {
    return cleanRegions(JSON.parse(raw));
  } catch {
    return [];
  }
}

async function exposeRow(row: SubscriptionRow, secret: string) {
  return {
    id: row.id,
    name: row.name,
    url: await decryptSubscriptionUrl(row.url_encrypted, secret),
    enabled: Boolean(row.enabled),
    allowed_regions: parseRegions(row.allowed_regions_json),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

export async function listSubscriptions(db: D1Database, secret: string) {
  await ensureSubscriptionTable(db);
  const rows = await getSubscriptionList(db);
  return Promise.all(rows.results.map((row) => exposeRow(row, secret)));
}

export async function readSubscription(db: D1Database, id: string, secret: string) {
  await ensureSubscriptionTable(db);
  const row = await getSubscriptionById(db, id);
  return row ? exposeRow(row, secret) : null;
}

export async function createSubscription(db: D1Database, payload: SubscriptionPayload, secret: string) {
  await ensureSubscriptionTable(db);
  const id = crypto.randomUUID();
  const regions = cleanRegions(payload.allowed_regions);
  const enabled = payload.enabled !== false;
  const urlEncrypted = await encryptSubscriptionUrl(payload.url, secret);
  await db.prepare(`
    INSERT INTO subscriptions (id, name, url_encrypted, enabled, allowed_regions_json)
    VALUES (?, ?, ?, ?, ?)
  `).bind(id, payload.name.trim(), urlEncrypted, enabled ? 1 : 0, JSON.stringify(regions)).run();
  return { id };
}

export async function updateSubscription(db: D1Database, id: string, payload: SubscriptionPayload, secret: string) {
  await ensureSubscriptionTable(db);
  const current = await getSubscriptionById(db, id);
  if (!current) return null;
  const regions = cleanRegions(payload.allowed_regions);
  const enabled = payload.enabled !== false;
  const urlEncrypted = await encryptSubscriptionUrl(payload.url, secret);
  const result = await db.prepare(`
    UPDATE subscriptions
    SET name = ?, url_encrypted = ?, enabled = ?, allowed_regions_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).bind(payload.name.trim(), urlEncrypted, enabled ? 1 : 0, JSON.stringify(regions), id).run();
  return result.meta.changes ? readSubscription(db, id, secret) : null;
}

export async function setSubscriptionEnabled(db: D1Database, id: string, enabled: boolean) {
  await ensureSubscriptionTable(db);
  const current = await getSubscriptionById(db, id);
  if (!current) return null;
  if (enabled && !parseRegions(current.allowed_regions_json).length) throw new Error('allowed_region_required');
  const result = await db.prepare('UPDATE subscriptions SET enabled = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(enabled ? 1 : 0, id).run();
  return result.meta.changes ? { success: true, enabled } : null;
}

export async function deleteSubscription(db: D1Database, id: string) {
  await ensureSubscriptionTable(db);
  return db.prepare('DELETE FROM subscriptions WHERE id = ?').bind(id).run();
}

function rawNodes(payload: any) {
  return Array.isArray(payload) ? payload : payload?.outbounds || [];
}

function normalizeNodes(payload: any) {
  const banned = new RegExp(DEFAULT_BANNED_PATTERN, 'i');
  const seen = new Set<string>();
  return rawNodes(payload).map((node: any) => {
    if (node?.tls?.utls?.fingerprint !== undefined) node.tls.utls.fingerprint = String(node.tls.utls.fingerprint);
    if (node?.tls?.reality?.short_id !== undefined) node.tls.reality.short_id = String(node.tls.reality.short_id);
    return node;
  }).filter((node: any) => {
    const tag = String(node?.tag || '');
    if (!node?.type || STRUCTURAL_TYPES.has(node.type) || banned.test(tag) || /(?:[1-9]\.[1-9]|[2-9]\.\d+)x/i.test(tag) || seen.has(tag)) return false;
    seen.add(tag);
    return true;
  });
}

function countRegions(nodes: any[], allowedRegions: string[], definitions: RegionDefinition[]) {
  const active = definitions.filter((region) => region.enabled);
  const regions = Object.fromEntries(active.map((region) => [region.id, 0]));
  let unmatched = 0;
  for (const node of nodes) {
    const tag = String(node?.tag || '').toUpperCase();
    const matched = active.some((region) => {
      if (allowedRegions.length && !allowedRegions.includes(region.id)) return false;
      const hit = region.keywords.some((keyword) => tag.includes(String(keyword).toUpperCase()));
      if (hit) regions[region.id] += 1;
      return hit;
    });
    if (!matched) unmatched += 1;
  }
  return { ...regions, unmatched };
}

async function fetchJsonSafe(url: string, timeoutMs = 10000, maxBytes = 5000000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'Mozilla/5.0 (Clash)' }
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new Error('订阅响应过大。');
    const reader = response.body?.getReader();
    if (!reader) return response.json();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('订阅响应过大。');
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder().decode(bytes));
  } finally {
    clearTimeout(timer);
  }
}

function withCacheBust(url: string) {
  const parsed = new URL(url);
  parsed.searchParams.set('t', String(Date.now()));
  return parsed.toString();
}

export async function testSubscription(subscription: Partial<SubscriptionPayload> & { id?: string }, regions: RegionDefinition[] = []): Promise<SubscriptionTestReport> {
  const startedAt = Date.now();
  const name = String(subscription?.name || '').trim() || '未命名订阅';
  try {
    const url = new URL(String(subscription?.url || ''));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('订阅源 URL 格式不正确。');
    const payload = await fetchJsonSafe(withCacheBust(url.toString()));
    const rawCount = rawNodes(payload).length;
    const nodes = normalizeNodes(payload);
    return {
      success: true,
      status: nodes.length ? 'success' : 'warning',
      id: subscription?.id,
      name,
      duration_ms: Date.now() - startedAt,
      raw_nodes: rawCount,
      valid_nodes: nodes.length,
      regions: countRegions(nodes, cleanRegions(subscription?.allowed_regions), regions),
      warnings: nodes.length ? [] : ['没有可用节点。']
    };
  } catch (error) {
    return {
      success: false,
      status: 'error',
      id: subscription?.id,
      name,
      duration_ms: Date.now() - startedAt,
      raw_nodes: 0,
      valid_nodes: 0,
      error: error instanceof Error ? error.message : '订阅源测试失败。'
    };
  }
}
