import { Hono } from 'hono';
import { cors } from 'hono/cors';
import {
  createTemplate,
  deleteTemplate,
  ensureSchema,
  listTemplateVersions,
  listTemplates,
  readTemplate,
  restoreTemplateVersion,
  stripSchema,
  updateTemplate
} from './templates';
import {
  createSubscription,
  deleteSubscription,
  listSubscriptions,
  readSubscription,
  setSubscriptionEnabled,
  testSubscription,
  updateSubscription
} from './subscriptions';
import {
  createClientProfile,
  deleteClientProfile,
  listClientProfiles,
  readClientProfile,
  readClientProfileByToken,
  resetClientProfileToken,
  setClientProfileEnabled,
  updateClientProfile,
  validateClientProfilePayload
} from './clientProfiles';
import { issueToken, verifyToken } from './auth';
import { generateClientConfig, GenerationError } from './generation';
import { listGenerationRuns, readConfigCache, saveConfigCache, saveGenerationRun } from './generationRuns';
import { readGenerationSettings, updateGenerationSettings } from './settings';
import { cleanRegions, ensureJsonString, isNonEmptyString, isSafeHttpUrl, isValidTemplateId } from '../../shared/src/validators';

type Bindings = {
  ASSETS: Fetcher;
  SINGBOX_DB: D1Database;
  ADMIN_PASSWORD: string;
  TOKEN_SECRET: string;
};

const app = new Hono<{ Bindings: Bindings }>();
app.use('/*', cors());

function jsonError(message: string, status = 400, code = 'BAD_REQUEST') {
  return new Response(JSON.stringify({ error: { code, message } }), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function hasRequiredSecrets(env: Bindings) {
  return Boolean(env.ADMIN_PASSWORD && env.TOKEN_SECRET);
}

function validateSubscriptionPayload(body: any) {
  if (!body || typeof body !== 'object') return 'Missing request body';
  if (!isNonEmptyString(body.name) || body.name.trim().length > 80) return 'Subscription name must be 1-80 characters';
  if (!isSafeHttpUrl(body.url)) return 'Subscription URL must be http or https';
  if (body.enabled !== undefined && typeof body.enabled !== 'boolean') return 'Enabled must be boolean';
  const regions = cleanRegions(body.allowed_regions);
  if ((body.enabled ?? true) && !regions.length) return 'Enabled subscription requires at least one allowed region';
  return '';
}

function validateRawConfig(rawConfig: string) {
  try {
    ensureJsonString(rawConfig);
    return true;
  } catch {
    return false;
  }
}

async function requireAdminAuth(c: any, next: any) {
  if (!c.env.TOKEN_SECRET) return jsonError('Server auth is not configured', 500, 'SERVER_CONFIG_ERROR');
  const auth = c.req.header('Authorization') || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return jsonError('Missing token', 401, 'UNAUTHORIZED');
  const payload = await verifyToken(token, c.env.TOKEN_SECRET);
  if (!payload) return jsonError('Invalid or expired token', 401, 'UNAUTHORIZED');
  await next();
}

app.get('/api/health', (c) => c.json({
  ok: hasRequiredSecrets(c.env),
  checks: {
    adminPassword: Boolean(c.env.ADMIN_PASSWORD),
    tokenSecret: Boolean(c.env.TOKEN_SECRET),
    database: Boolean(c.env.SINGBOX_DB),
    assets: Boolean(c.env.ASSETS)
  }
}));

app.post('/api/auth/login', async (c) => {
  const body = await c.req.json().catch(() => null) as { password?: string } | null;
  if (!hasRequiredSecrets(c.env)) return jsonError('Server auth is not configured', 500, 'SERVER_CONFIG_ERROR');
  if (!body?.password) return jsonError('Password is required', 400, 'VALIDATION_ERROR');
  if (!c.env.ADMIN_PASSWORD || body.password !== c.env.ADMIN_PASSWORD) {
    return jsonError('Invalid password', 401, 'UNAUTHORIZED');
  }
  const token = await issueToken(c.env.TOKEN_SECRET);
  const payload = await verifyToken(token, c.env.TOKEN_SECRET);
  return c.json({ token, expiresAt: payload?.exp ?? 0 });
});

app.get('/api/templates', requireAdminAuth, async (c) => c.json(await listTemplates(c.env.SINGBOX_DB)));
app.get('/api/templates/:id', requireAdminAuth, async (c) => {
  const item = await readTemplate(c.env.SINGBOX_DB, c.req.param('id'));
  if (!item) return jsonError('Not found', 404, 'NOT_FOUND');
  return c.json(item);
});

app.get('/api/templates/:id/versions', requireAdminAuth, async (c) => {
  const id = c.req.param('id');
  const item = await readTemplate(c.env.SINGBOX_DB, id);
  if (!item) return jsonError('Not found', 404, 'NOT_FOUND');
  return c.json(await listTemplateVersions(c.env.SINGBOX_DB, id));
});

app.post('/api/templates', requireAdminAuth, async (c) => {
  const body = await c.req.json().catch(() => null) as { id?: string; name?: string; raw_config?: string } | null;
  if (!isValidTemplateId(body?.id) || !isNonEmptyString(body?.name) || !isNonEmptyString(body?.raw_config)) {
    return jsonError('Missing or invalid required fields', 400, 'VALIDATION_ERROR');
  }
  if (!validateRawConfig(body.raw_config)) return jsonError('Template config must be valid JSON', 400, 'VALIDATION_ERROR');
  try {
    await createTemplate(c.env.SINGBOX_DB, body.id, body.name, body.raw_config);
    return c.json({ success: true });
  } catch (e) {
    return jsonError('Template already exists or insert failed', 409, 'CONFLICT');
  }
});

app.put('/api/templates/:id', requireAdminAuth, async (c) => {
  const id = c.req.param('id');
  const body = await c.req.json().catch(() => null) as { name?: string; raw_config?: string; version_note?: string } | null;
  if (!isNonEmptyString(body?.name) || !isNonEmptyString(body?.raw_config)) return jsonError('Missing required fields', 400, 'VALIDATION_ERROR');
  if (!validateRawConfig(body.raw_config)) return jsonError('Template config must be valid JSON', 400, 'VALIDATION_ERROR');
  const result = await updateTemplate(c.env.SINGBOX_DB, id, body.name, body.raw_config, body?.version_note || '手动保存');
  if (!result.meta.changes) return jsonError('Not found', 404, 'NOT_FOUND');
  return c.json({ success: true });
});

app.post('/api/templates/:id/versions/:versionId/restore', requireAdminAuth, async (c) => {
  const restored = await restoreTemplateVersion(c.env.SINGBOX_DB, c.req.param('id'), c.req.param('versionId'));
  if (!restored) return jsonError('Not found', 404, 'NOT_FOUND');
  return c.json(restored);
});

app.delete('/api/templates/:id', requireAdminAuth, async (c) => {
  const result = await deleteTemplate(c.env.SINGBOX_DB, c.req.param('id'));
  if (!result.meta.changes) return jsonError('Not found', 404, 'NOT_FOUND');
  return c.json({ success: true });
});

app.get('/api/subscriptions', requireAdminAuth, async (c) => {
  try {
    return c.json(await listSubscriptions(c.env.SINGBOX_DB, c.env.TOKEN_SECRET));
  } catch {
    return jsonError('Subscription data cannot be decrypted', 409, 'SUBSCRIPTION_DECRYPTION_FAILED');
  }
});

app.post('/api/subscriptions', requireAdminAuth, async (c) => {
  const body = await c.req.json().catch(() => null) as any;
  const error = validateSubscriptionPayload(body);
  if (error) return jsonError(error, 400, 'VALIDATION_ERROR');
  const result = await createSubscription(c.env.SINGBOX_DB, {
    name: body.name,
    url: body.url,
    enabled: body.enabled ?? true,
    allowed_regions: cleanRegions(body.allowed_regions) as any
  }, c.env.TOKEN_SECRET);
  return c.json(result, 201);
});

app.put('/api/subscriptions/:id', requireAdminAuth, async (c) => {
  const body = await c.req.json().catch(() => null) as any;
  const error = validateSubscriptionPayload(body);
  if (error) return jsonError(error, 400, 'VALIDATION_ERROR');
  const updated = await updateSubscription(c.env.SINGBOX_DB, c.req.param('id'), {
    name: body.name,
    url: body.url,
    enabled: body.enabled ?? true,
    allowed_regions: cleanRegions(body.allowed_regions) as any
  }, c.env.TOKEN_SECRET);
  if (!updated) return jsonError('Not found', 404, 'NOT_FOUND');
  return c.json(updated);
});

app.put('/api/subscriptions/:id/enabled', requireAdminAuth, async (c) => {
  const body = await c.req.json().catch(() => null) as { enabled?: boolean } | null;
  if (typeof body?.enabled !== 'boolean') return jsonError('Enabled must be boolean', 400, 'VALIDATION_ERROR');
  try {
    const result = await setSubscriptionEnabled(c.env.SINGBOX_DB, c.req.param('id'), body.enabled);
    if (!result) return jsonError('Not found', 404, 'NOT_FOUND');
    return c.json(result);
  } catch (error) {
    if (error instanceof Error && error.message === 'allowed_region_required') {
      return jsonError('Enabled subscription requires at least one allowed region', 400, 'VALIDATION_ERROR');
    }
    throw error;
  }
});

app.delete('/api/subscriptions/:id', requireAdminAuth, async (c) => {
  const result = await deleteSubscription(c.env.SINGBOX_DB, c.req.param('id'));
  if (!result.meta.changes) return jsonError('Not found', 404, 'NOT_FOUND');
  return c.json({ success: true });
});

app.post('/api/subscriptions/:id/test', requireAdminAuth, async (c) => {
  const item = await readSubscription(c.env.SINGBOX_DB, c.req.param('id'), c.env.TOKEN_SECRET);
  if (!item) return jsonError('Not found', 404, 'NOT_FOUND');
  return c.json(await testSubscription(item, (await readGenerationSettings(c.env.SINGBOX_DB)).regions));
});

app.post('/api/subscription/test', requireAdminAuth, async (c) => {
  const body = await c.req.json().catch(() => null) as { subscription?: any } | null;
  const subscription = body?.subscription;
  if (!subscription || !isSafeHttpUrl(subscription.url)) return jsonError('Subscription URL must be http or https', 400, 'VALIDATION_ERROR');
  return c.json(await testSubscription({
    id: subscription.id,
    name: subscription.name,
    url: subscription.url,
    enabled: subscription.enabled ?? true,
    allowed_regions: cleanRegions(subscription.allowed_regions) as any
  }, (await readGenerationSettings(c.env.SINGBOX_DB)).regions));
});


app.get('/api/settings/generation', requireAdminAuth, async (c) => {
  return c.json(await readGenerationSettings(c.env.SINGBOX_DB));
});

app.put('/api/settings/generation', requireAdminAuth, async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body !== 'object') return jsonError('Missing request body');
  const current = await readGenerationSettings(c.env.SINGBOX_DB);
  const nextIds = new Set(Array.isArray((body as any).regions) ? (body as any).regions.map((region: any) => String(region?.id || '').trim().toUpperCase()) : current.regions.map((region) => region.id));
  const removed = current.regions.map((region) => region.id).filter((id) => !nextIds.has(id));
  if (removed.length) {
    const subscriptions = await listSubscriptions(c.env.SINGBOX_DB, c.env.TOKEN_SECRET);
    const subscriptionRefs = subscriptions.filter((subscription) => subscription.allowed_regions.some((id) => removed.includes(id))).map((subscription) => subscription.name);
    const templateRefs: string[] = [];
    for (const item of (await listTemplates(c.env.SINGBOX_DB))) {
      const template = await readTemplate(c.env.SINGBOX_DB, item.id);
      if (template && removed.some((id) => new RegExp(`(?:region|region\\+direct):[^\"']*\\b${id}\\b`).test(template.raw_config))) templateRefs.push(item.name);
    }
    if (subscriptionRefs.length || templateRefs.length) return jsonError(`无法删除区域 ${removed.join(', ')}：订阅引用 ${subscriptionRefs.join('、') || '无'}；模板引用 ${templateRefs.join('、') || '无'}。请先停用或移除引用。`, 409, 'REGION_IN_USE');
  }
  return c.json(await updateGenerationSettings(c.env.SINGBOX_DB, body));
});

app.get('/api/client-profiles', requireAdminAuth, async (c) => c.json(await listClientProfiles(c.env.SINGBOX_DB)));

app.get('/api/client-profiles/:id', requireAdminAuth, async (c) => {
  const item = await readClientProfile(c.env.SINGBOX_DB, c.req.param('id'));
  if (!item) return jsonError('Not found', 404, 'NOT_FOUND');
  return c.json(item);
});

app.post('/api/client-profiles', requireAdminAuth, async (c) => {
  const body = await c.req.json().catch(() => null) as any;
  const error = validateClientProfilePayload(body);
  if (error) return jsonError(error, 400, 'VALIDATION_ERROR');
  try {
    const created = await createClientProfile(c.env.SINGBOX_DB, body);
    return c.json(created, 201);
  } catch (error) {
    if (error instanceof Error && error.message === 'template_not_found') return jsonError('Template not found', 400, 'VALIDATION_ERROR');
    if (error instanceof Error && error.message === 'subscription_not_found') return jsonError('Subscription not found', 400, 'VALIDATION_ERROR');
    throw error;
  }
});

app.put('/api/client-profiles/:id', requireAdminAuth, async (c) => {
  const body = await c.req.json().catch(() => null) as any;
  const error = validateClientProfilePayload(body);
  if (error) return jsonError(error, 400, 'VALIDATION_ERROR');
  try {
    const updated = await updateClientProfile(c.env.SINGBOX_DB, c.req.param('id'), body);
    if (!updated) return jsonError('Not found', 404, 'NOT_FOUND');
    return c.json(updated);
  } catch (error) {
    if (error instanceof Error && error.message === 'template_not_found') return jsonError('Template not found', 400, 'VALIDATION_ERROR');
    if (error instanceof Error && error.message === 'subscription_not_found') return jsonError('Subscription not found', 400, 'VALIDATION_ERROR');
    throw error;
  }
});

app.put('/api/client-profiles/:id/enabled', requireAdminAuth, async (c) => {
  const body = await c.req.json().catch(() => null) as { enabled?: boolean } | null;
  if (typeof body?.enabled !== 'boolean') return jsonError('Enabled must be boolean', 400, 'VALIDATION_ERROR');
  const result = await setClientProfileEnabled(c.env.SINGBOX_DB, c.req.param('id'), body.enabled);
  if (!result) return jsonError('Not found', 404, 'NOT_FOUND');
  return c.json(result);
});

app.post('/api/client-profiles/:id/token/reset', requireAdminAuth, async (c) => {
  const result = await resetClientProfileToken(c.env.SINGBOX_DB, c.req.param('id'));
  if (!result) return jsonError('Not found', 404, 'NOT_FOUND');
  return c.json(result);
});

app.delete('/api/client-profiles/:id', requireAdminAuth, async (c) => {
  const result = await deleteClientProfile(c.env.SINGBOX_DB, c.req.param('id'));
  if (!result.meta.changes) return jsonError('Not found', 404, 'NOT_FOUND');
  return c.json({ success: true });
});

app.get('/api/client-profiles/:id/generation-runs', requireAdminAuth, async (c) => {
  const profile = await readClientProfile(c.env.SINGBOX_DB, c.req.param('id'));
  if (!profile) return jsonError('Not found', 404, 'NOT_FOUND');
  const limit = Number(c.req.query('limit') || 10);
  return c.json(await listGenerationRuns(c.env.SINGBOX_DB, profile.id, limit));
});

app.post('/api/client-profiles/:id/generate/test', requireAdminAuth, async (c) => {
  const profile = await readClientProfile(c.env.SINGBOX_DB, c.req.param('id'));
  if (!profile) return jsonError('Not found', 404, 'NOT_FOUND');
  const template = await readTemplate(c.env.SINGBOX_DB, profile.template_id);
  if (!template) return jsonError('Template not found', 404, 'NOT_FOUND');
  try {
    const result = await generateClientConfig(c.env.SINGBOX_DB, profile, stripSchema(ensureSchema(template.raw_config)), c.env.TOKEN_SECRET);
    await saveConfigCache(c.env.SINGBOX_DB, profile.id, result.output, result.summary);
    await saveGenerationRun(c.env.SINGBOX_DB, {
      client_profile_id: profile.id,
      status: 'success',
      trigger_type: 'manual',
      duration_ms: Number(result.summary.duration_ms || 0),
      summary: result.summary,
      steps: result.steps
    });
    return c.json(result);
  } catch (error) {
    if (error instanceof GenerationError) {
      await saveGenerationRun(c.env.SINGBOX_DB, {
        client_profile_id: profile.id,
        status: 'error',
        trigger_type: 'manual',
        duration_ms: Number(error.diagnostics.summary.duration_ms || 0),
        summary: error.diagnostics.summary,
        steps: error.diagnostics.steps,
        error: error.message
      });
      return c.json(error.diagnostics, 502);
    }
    await saveGenerationRun(c.env.SINGBOX_DB, {
      client_profile_id: profile.id,
      status: 'error',
      trigger_type: 'manual',
      duration_ms: 0,
      summary: {},
      steps: [],
      error: error instanceof Error ? error.message : 'generation_failed'
    });
    return jsonError('Generation failed', 502, 'GENERATION_FAILED');
  }
});

app.get('/sub/client/:token', async (c) => {
  const profile = await readClientProfileByToken(c.env.SINGBOX_DB, c.req.param('token'));
  if (!profile || !profile.enabled) return c.text('Subscription Not Found', 404);
  const template = await readTemplate(c.env.SINGBOX_DB, profile.template_id);
  if (!template) return c.text('Template Not Found', 404);
  try {
    const result = await generateClientConfig(c.env.SINGBOX_DB, profile, stripSchema(ensureSchema(template.raw_config)), c.env.TOKEN_SECRET);
    await saveConfigCache(c.env.SINGBOX_DB, profile.id, result.output, result.summary);
    await saveGenerationRun(c.env.SINGBOX_DB, {
      client_profile_id: profile.id,
      status: 'success',
      trigger_type: 'public',
      duration_ms: Number(result.summary.duration_ms || 0),
      summary: result.summary,
      steps: result.steps
    });
    return new Response(JSON.stringify(result.output, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  } catch (error) {
    const cache = await readConfigCache(c.env.SINGBOX_DB, profile.id);
    const message = error instanceof Error ? error.message : 'generation_failed';
    if (cache) {
      await saveGenerationRun(c.env.SINGBOX_DB, {
        client_profile_id: profile.id,
        status: 'fallback',
        trigger_type: 'public',
        duration_ms: 0,
        summary: { ...cache.summary, cache_updated_at: cache.updated_at, fallback_reason: message },
        steps: error instanceof GenerationError ? error.diagnostics.steps : [],
        error: message,
        used_cache: true
      });
      return new Response(JSON.stringify(cache.config, null, 2), {
        status: 200,
        headers: {
          'Content-Type': 'application/json',
          'x-singbox-meta-fallback': '1',
          'x-singbox-meta-cache-updated-at': cache.updated_at || ''
        }
      });
    }
    if (error instanceof GenerationError) {
      await saveGenerationRun(c.env.SINGBOX_DB, {
        client_profile_id: profile.id,
        status: 'error',
        trigger_type: 'public',
        duration_ms: Number(error.diagnostics.summary.duration_ms || 0),
        summary: error.diagnostics.summary,
        steps: error.diagnostics.steps,
        error: error.message
      });
      return c.text(`Generation Failed: ${error.message}`, 502);
    }
    await saveGenerationRun(c.env.SINGBOX_DB, {
      client_profile_id: profile.id,
      status: 'error',
      trigger_type: 'public',
      duration_ms: 0,
      summary: {},
      steps: [],
      error: message
    });
    return c.text('Generation Failed', 502);
  }
});

app.get('/sub/:id', async (c) => {
  const item = await readTemplate(c.env.SINGBOX_DB, c.req.param('id'));
  if (!item) return c.text('Subscription Not Found', 404);
  try {
    const config = JSON.parse(stripSchema(ensureSchema(item.raw_config)));
    return new Response(JSON.stringify(config, null, 2), {
      headers: { 'Content-Type': 'application/json; charset=utf-8' }
    });
  } catch {
    return c.text('Internal JSON Error', 500);
  }
});

function shouldHandleWithApi(pathname: string) {
  return pathname === '/api' || pathname.startsWith('/api/') || pathname.startsWith('/sub/');
}

export default {
  fetch(request: Request, env: Bindings, ctx: ExecutionContext) {
    const url = new URL(request.url);
    if (shouldHandleWithApi(url.pathname)) {
      return app.fetch(request, env, ctx);
    }

    return env.ASSETS.fetch(request);
  }
};
