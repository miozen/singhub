import type { ClientProfileRecord, GenerationSettings, SubscriptionRecord } from '../../shared/src/types';
import { readSubscription } from './subscriptions';
import { DNS_OUTBOUND_TAG, MANUAL_SELECTOR_OUTBOUND_TAG, readGenerationSettings } from './settings';

const STRUCTURAL_TYPES = new Set(['selector', 'urltest', 'direct', 'block', 'dns']);

type StepStatus = 'success' | 'warning' | 'error';
type GenerationStep = { name: string; status: StepStatus; message: string; details?: Record<string, unknown> };
type NodeLike = Record<string, any>;
type Source = { id?: string; name: string; nodes: NodeLike[]; allowed_regions: string[] };

export type GenerationResult = {
  success: true;
  output: Record<string, any>;
  summary: Record<string, unknown>;
  steps: GenerationStep[];
};

export class GenerationError extends Error {
  diagnostics: { success: false; error: string; summary: Record<string, unknown>; steps: GenerationStep[] };

  constructor(message: string, summary: Record<string, unknown>, steps: GenerationStep[]) {
    super(message);
    this.name = 'GenerationError';
    this.diagnostics = { success: false, error: message, summary, steps };
  }
}

function clone<T>(value: T): T {
  return typeof structuredClone === 'function' ? structuredClone(value) : JSON.parse(JSON.stringify(value));
}

function validateTemplate(config: any, options: { skipDnsDetourValidation?: boolean; allowedMissingOutboundTags?: string[] } = {}) {
  if (!config || typeof config !== 'object' || !Array.isArray(config.outbounds)) throw new Error('template_outbounds_required');
  const tags = new Set<string>();
  for (const outbound of config.outbounds) {
    if (!outbound?.tag || !outbound?.type) throw new Error('template_outbound_invalid');
    if (tags.has(outbound.tag)) throw new Error(`duplicate_tag:${outbound.tag}`);
    tags.add(outbound.tag);
  }
  const missing: string[] = [];
  for (const outbound of config.outbounds) {
    for (const tag of outbound.outbounds || []) {
      if (!tags.has(tag) && !options.allowedMissingOutboundTags?.includes(tag)) missing.push(`outbound:${outbound.tag}->${tag}`);
    }
  }
  if (!options.skipDnsDetourValidation) {
    for (const server of config.dns?.servers || []) {
      if (server.detour && !tags.has(server.detour)) missing.push(`dns:${server.tag || server.server}->${server.detour}`);
    }
  }
  for (const [index, rule] of (config.route?.rules || []).entries()) {
    if (rule.outbound && !tags.has(rule.outbound)) missing.push(`route:${index}->${rule.outbound}`);
  }
  if (missing.length) throw new Error(`template_reference_missing:${missing.slice(0, 5).join(',')}`);
  return true;
}

function parseRule(value = '') {
  if (value === 'keep' || value === 'main' || value === 'direct_only' || value === 'all_regions') return { mode: value, regions: [] as string[], includeDirect: false };
  const match = value.match(/^(region|region\+direct):(.+)$/);
  return match ? {
    mode: 'region',
    includeDirect: match[1].includes('+direct'),
    regions: match[2].split(',').map((x) => x.trim()).filter(Boolean)
  } : null;
}

function rawNodes(payload: any) {
  return Array.isArray(payload) ? payload : payload?.outbounds || [];
}

function normalizeNodes(payload: any, settings: GenerationSettings) {
  const banned = new RegExp(settings.banned_pattern, 'i');
  const seen = new Set<string>();
  return rawNodes(payload).map((node: NodeLike) => {
    const next = clone(node);
    if (next?.tls?.utls?.fingerprint !== undefined) next.tls.utls.fingerprint = String(next.tls.utls.fingerprint);
    if (next?.tls?.reality?.short_id !== undefined) next.tls.reality.short_id = String(next.tls.reality.short_id);
    return next;
  }).filter((node: NodeLike) => {
    const tag = String(node?.tag || '');
    if (!node?.type || STRUCTURAL_TYPES.has(node.type) || banned.test(tag) || /(?:[1-9]\.[1-9]|[2-9]\.\d+)x/i.test(tag) || seen.has(tag)) return false;
    seen.add(tag);
    return true;
  });
}

function countRegions(nodes: NodeLike[], allowedRegions: string[], settings: GenerationSettings) {
  const activeRegions = settings.regions.filter((region) => region.enabled);
  const regions = Object.fromEntries(activeRegions.map((region) => [region.id, 0]));
  let unmatched = 0;
  for (const node of nodes) {
    const tag = String(node?.tag || '').toUpperCase();
    const matched = activeRegions.some((region) => {
      if (allowedRegions.length && !allowedRegions.includes(region.id)) return false;
      const hit = region.keywords.some((keyword) => tag.includes(String(keyword).toUpperCase()));
      if (hit) regions[region] += 1;
      return hit;
    });
    if (!matched) unmatched += 1;
  }
  return { ...regions, unmatched };
}

function buildRegionalGroups(sources: Source[], settings: GenerationSettings) {
  const groups: NodeLike[] = [];
  const activeRegions = settings.regions.filter((region) => region.enabled);
  const byRegion: Record<string, string[]> = Object.fromEntries(activeRegions.map((region) => [region.id, []]));
  for (const source of sources) for (const region of activeRegions.filter((region) => source.allowed_regions.includes(region.id))) {
    const tags = source.nodes
      .filter((node) => activeRegions.find((candidate) => candidate.keywords.some((keyword) => String(node.tag || '').toUpperCase().includes(String(keyword).toUpperCase())))?.id === region.id)
      .map((node) => node.tag);
    if (!tags.length) continue;
    const tag = `${region.emoji} ${region.id}-${source.name}`.trim();
    groups.push({ type: 'urltest', tag, outbounds: tags, ...settings.urltest, interrupt_exist_connections: true });
    byRegion[region.id].push(tag);
  }
  return { groups, byRegion };
}

function buildDnsUrltestGroup(nodes: NodeLike[], settings: GenerationSettings) {
  if (!settings.dns_urltest.enabled) return null;
  const keywords = settings.dns_urltest.keywords.map((keyword) => keyword.toUpperCase());
  const outbounds = nodes
    .filter((node) => keywords.some((keyword) => String(node.tag || '').toUpperCase().includes(keyword)))
    .map((node) => node.tag);
  if (!outbounds.length) return null;
  return {
    type: 'urltest',
    tag: DNS_OUTBOUND_TAG,
    outbounds,
    url: settings.dns_urltest.url,
    interval: settings.dns_urltest.interval,
    tolerance: settings.dns_urltest.tolerance,
    interrupt_exist_connections: true
  };
}

function buildManualSelectorGroup(nodes: NodeLike[], settings: GenerationSettings) {
  if (!settings.manual_selector.enabled || !settings.manual_selector.keywords.length) return null;
  const keywords = settings.manual_selector.keywords.map((keyword) => keyword.toUpperCase());
  const outbounds = nodes
    .filter((node) => keywords.some((keyword) => String(node.tag || '').toUpperCase().includes(keyword)))
    .map((node) => node.tag);
  if (!outbounds.length) return null;
  return {
    type: 'selector',
    tag: MANUAL_SELECTOR_OUTBOUND_TAG,
    outbounds,
    interrupt_exist_connections: true
  };
}

function cleanReferences(config: any) {
  const valid = new Set((config.outbounds || []).map((outbound: NodeLike) => outbound.tag));
  for (const outbound of config.outbounds || []) {
    if (Array.isArray(outbound.outbounds)) outbound.outbounds = outbound.outbounds.filter((tag: string) => valid.has(tag));
  }
  for (const server of config.dns?.servers || []) {
    if (server.detour && !valid.has(server.detour)) delete server.detour;
  }
}

function injectTemplate(template: any, nodes: NodeLike[], groups: NodeLike[], byRegion: Record<string, string[]>, directTag: string, settings: GenerationSettings, dnsGroup: NodeLike | null, manualSelectorGroup: NodeLike | null) {
  const config = clone(template);
  const requiresManualSelector = config.outbounds.some((outbound: NodeLike) =>
    outbound.type === 'selector' && Array.isArray(outbound.outbounds) && outbound.outbounds.includes(MANUAL_SELECTOR_OUTBOUND_TAG)
  );
  if (dnsGroup && config.outbounds.some((outbound: NodeLike) => outbound.tag === DNS_OUTBOUND_TAG)) {
    throw new Error(`dns_outbound_tag_conflict:${DNS_OUTBOUND_TAG}`);
  }
  if (dnsGroup && nodes.some((node) => node.tag === DNS_OUTBOUND_TAG)) {
    throw new Error(`dns_node_tag_conflict:${DNS_OUTBOUND_TAG}`);
  }
  if (manualSelectorGroup && config.outbounds.some((outbound: NodeLike) => outbound.tag === MANUAL_SELECTOR_OUTBOUND_TAG)) {
    throw new Error(`manual_selector_outbound_tag_conflict:${MANUAL_SELECTOR_OUTBOUND_TAG}`);
  }
  if (manualSelectorGroup && nodes.some((node) => node.tag === MANUAL_SELECTOR_OUTBOUND_TAG)) {
    throw new Error(`manual_selector_node_tag_conflict:${MANUAL_SELECTOR_OUTBOUND_TAG}`);
  }
  if (requiresManualSelector && !manualSelectorGroup) {
    throw new Error(`manual_selector_required_but_unavailable:${MANUAL_SELECTOR_OUTBOUND_TAG}`);
  }
  const allRegionalTags = Object.values(byRegion).flat();
  const keywords = settings.regions.filter((region) => region.enabled).flatMap((region) => region.keywords);
  config.outbounds = config.outbounds.map((outbound: NodeLike) => {
    if (outbound.type !== 'selector') return outbound;
    const includesManualSelector = Array.isArray(outbound.outbounds) && outbound.outbounds.includes(MANUAL_SELECTOR_OUTBOUND_TAG);
    const rule = parseRule(outbound.x_rule);
    delete outbound.x_rule;
    if (rule?.mode === 'keep') return outbound;
    let selected = ['🗽 节点选择'];
    if (!rule) {
      if (outbound.tag === '🗽 节点选择') {
        const unmatched = nodes.filter((node) => !keywords.some((keyword) => String(node.tag || '').toUpperCase().includes(String(keyword).toUpperCase()))).map((node) => node.tag);
        selected = [...allRegionalTags, ...unmatched];
      } else if (['🦚 PeacockTV', '🅾️ OpenAI'].includes(outbound.tag)) selected.push(...(byRegion.US || []));
      else if (outbound.tag === '🌀 Hamivideo') selected.push(...(byRegion.TW || []));
      else if (outbound.tag === '📹️ Viu') selected.push(...(byRegion.HK || []));
      else if (outbound.tag === '🎞 Emby') selected.push(directTag, ...(byRegion.HK || []), ...(byRegion.SG || []), ...(byRegion.US || []));
      else if (['🍎 Apple', '🐧 Tencent'].includes(outbound.tag)) selected.push(directTag);
      else if (!['🐟 漏网之鱼', '🌐 GLOBAL'].includes(outbound.tag)) selected.push(...allRegionalTags);
    } else if (rule.mode === 'direct_only') selected = [directTag];
    else if (rule.mode === 'main') {
      const unmatched = nodes.filter((node) => !keywords.some((keyword) => String(node.tag || '').toUpperCase().includes(String(keyword).toUpperCase()))).map((node) => node.tag);
      selected = [...allRegionalTags, ...unmatched];
    } else if (rule.mode === 'all_regions') selected.push(...allRegionalTags);
    else selected.push(...(rule.includeDirect ? [directTag] : []), ...rule.regions.flatMap((region) => byRegion[region] || []));
    if (includesManualSelector) selected.push(MANUAL_SELECTOR_OUTBOUND_TAG);
    outbound.outbounds = [...new Set(selected)];
    return outbound;
  });
  const routedDnsServers = (config.dns?.servers || []).filter((server: NodeLike) => Boolean(server.detour));
  if (routedDnsServers.length && !dnsGroup && !config.outbounds.some((outbound: NodeLike) => outbound.tag === '🗽 节点选择')) {
    throw new Error('dns_fallback_outbound_missing:🗽 节点选择');
  }
  for (const server of routedDnsServers) {
    server.detour = dnsGroup ? DNS_OUTBOUND_TAG : '🗽 节点选择';
  }
  config.outbounds.push(...groups, ...(dnsGroup ? [dnsGroup] : []), ...(manualSelectorGroup ? [manualSelectorGroup] : []), ...nodes);
  cleanReferences(config);
  validateTemplate(config);
  return config;
}

async function fetchJsonSafe(url: string, settings: GenerationSettings) {
  const timeoutMs = settings.fetch_timeout_ms;
  const maxBytes = settings.max_subscription_bytes;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { 'user-agent': settings.subscription_user_agent } });
    if (!response.ok) throw new Error(`upstream_http_${response.status}`);
    const declared = Number(response.headers.get('content-length') || 0);
    if (declared > maxBytes) throw new Error('upstream_too_large');
    const reader = response.body?.getReader();
    if (!reader) return response.json();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maxBytes) throw new Error('upstream_too_large');
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

async function fetchSubscription(subscription: SubscriptionRecord, settings: GenerationSettings) {
  const startedAt = Date.now();
  const name = subscription.name || '未命名订阅';
  try {
    const payload = await fetchJsonSafe(withCacheBust(subscription.url), settings);
    const rawCount = rawNodes(payload).length;
    const nodes = normalizeNodes(payload, settings);
    return {
      success: true,
      status: nodes.length ? 'success' as const : 'warning' as const,
      id: subscription.id,
      name,
      duration_ms: Date.now() - startedAt,
      raw_nodes: rawCount,
      valid_nodes: nodes.length,
      nodes,
      regions: countRegions(nodes, subscription.allowed_regions, settings),
      warnings: nodes.length ? [] : ['没有可用节点。']
    };
  } catch (error) {
    return {
      success: false,
      status: 'error' as const,
      id: subscription.id,
      name,
      duration_ms: Date.now() - startedAt,
      raw_nodes: 0,
      valid_nodes: 0,
      nodes: [] as NodeLike[],
      error: error instanceof Error ? error.message : 'subscription_fetch_failed'
    };
  }
}

function parseOverride(value?: string | null) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function generateClientConfig(db: D1Database, profile: ClientProfileRecord, rawTemplate: string, secret: string): Promise<GenerationResult> {
  const startedAt = Date.now();
  const settings = await readGenerationSettings(db);
  const steps: GenerationStep[] = [];
  const progress: Record<string, unknown> = {};
  const addStep = (name: string, status: StepStatus, message: string, details: Record<string, unknown> = {}) => steps.push({ name, status, message, details });
  const abort = (message: string): never => {
    throw new GenerationError(message, { ...progress, duration_ms: Date.now() - startedAt, warnings: steps.filter((step) => step.status === 'warning').length }, steps);
  };

  let template: any;
  try {
    template = JSON.parse(rawTemplate);
    validateTemplate(template, { skipDnsDetourValidation: true, allowedMissingOutboundTags: [MANUAL_SELECTOR_OUTBOUND_TAG] });
  } catch (error) {
    addStep('模板来源', 'error', `客户端绑定模板无效：${error instanceof Error ? error.message : 'template_invalid'}`);
    abort(error instanceof Error ? error.message : 'template_invalid');
  }
  Object.assign(progress, {
    template_id: profile.template_id,
    template_name: profile.template_name || profile.template_id,
    settings: {
      fetch_timeout_ms: settings.fetch_timeout_ms,
      max_subscription_bytes: settings.max_subscription_bytes,
      banned_pattern: settings.banned_pattern,
      urltest: settings.urltest,
      dns_urltest: settings.dns_urltest,
      manual_selector: settings.manual_selector
    }
  });
  addStep('系统设置', 'success', '已读取当前生成设置。', {
    fetch_timeout_ms: settings.fetch_timeout_ms,
    max_subscription_bytes: settings.max_subscription_bytes,
    banned_pattern: settings.banned_pattern,
    urltest: settings.urltest,
    dns_urltest: settings.dns_urltest,
    manual_selector: settings.manual_selector
  });
  addStep('模板来源', 'success', '已读取客户端绑定模板。', { template_id: profile.template_id, template_name: profile.template_name || profile.template_id });

  const enabledBindings = profile.subscriptions.filter((binding) => binding.enabled).sort((a, b) => a.position - b.position);
  const subscriptions = (await Promise.all(enabledBindings.map(async (binding) => {
    const subscription = await readSubscription(db, binding.subscription_id, secret);
    if (!subscription || !subscription.enabled) return null;
    return { ...subscription, ...parseOverride(binding.override_json) } as SubscriptionRecord;
  }))).filter((item): item is SubscriptionRecord => Boolean(item));

  const fetched = await Promise.all(subscriptions.map((subscription) => fetchSubscription(subscription, settings)));
  const successCount = fetched.filter((item) => item.status === 'success').length;
  const warningCount = fetched.filter((item) => item.status === 'warning').length;
  const failedCount = fetched.filter((item) => item.status === 'error').length;
  const reports = fetched.map(({ nodes: _nodes, ...report }) => report);
  Object.assign(progress, {
    subscriptions: subscriptions.length,
    successful_subscriptions: successCount,
    warning_subscriptions: warningCount,
    failed_subscriptions: failedCount,
    raw_nodes: reports.reduce((total, report) => total + report.raw_nodes, 0),
    reports
  });
  addStep('订阅源拉取', !subscriptions.length || failedCount || warningCount ? 'warning' : 'success',
    subscriptions.length
      ? `启用 ${subscriptions.length} 个，成功 ${successCount} 个，警告 ${warningCount} 个，失败 ${failedCount} 个。`
      : '没有启用的订阅源，仅使用模板固定配置。',
    { items: reports });

  const sources = fetched.filter((item) => item.nodes.length).map((item) => ({
    id: item.id,
    name: item.name,
    nodes: item.nodes,
    allowed_regions: subscriptions.find((subscription) => subscription.id === item.id)?.allowed_regions || []
  }));
  const cleanedCount = sources.reduce((total, source) => total + source.nodes.length, 0);
  const seen = new Set<string>();
  const nodes = sources.flatMap((source) => source.nodes).filter((node) => !seen.has(node.tag) && seen.add(node.tag));
  if (subscriptions.length && !nodes.length) {
    addStep('节点清洗', 'error', '没有可用于生成配置的有效节点。');
    abort(failedCount === subscriptions.length ? 'all_subscriptions_failed' : 'no_valid_nodes');
  }
  const rawCount = reports.reduce((total, report) => total + report.raw_nodes, 0);
  Object.assign(progress, { nodes: nodes.length });
  addStep('节点清洗', 'success', `保留 ${nodes.length} 个有效节点。`, {
    raw_nodes: rawCount,
    cleaned_nodes: cleanedCount,
    duplicate_nodes: cleanedCount - nodes.length,
    valid_nodes: nodes.length
  });

  const { groups, byRegion } = buildRegionalGroups(sources, settings);
  Object.assign(progress, { groups: groups.length });
  addStep('区域分组', 'success', `生成 ${groups.length} 个 urltest 分组。`, {
    total: groups.length,
    regions: Object.fromEntries(settings.regions.filter((region) => region.enabled).map((region) => [region.id, byRegion[region.id]?.length || 0])),
    urltest: settings.urltest
  });

  const dnsGroup = buildDnsUrltestGroup(nodes, settings);
  const manualSelectorGroup = buildManualSelectorGroup(nodes, settings);
  const dnsDetourCount = (template.dns?.servers || []).filter((server: NodeLike) => Boolean(server.detour)).length;
  if (!settings.dns_urltest.enabled) {
    addStep('DNS 专用分组', 'warning', `DNS 专用节点组未启用，${dnsDetourCount} 个 DNS detour 已回退到 🗽 节点选择。`, {
      fallback_detours: dnsDetourCount
    });
  } else if (!dnsGroup) {
    addStep('DNS 专用分组', 'warning', `没有匹配 DNS 关键词的节点，${dnsDetourCount} 个 DNS detour 已回退到 🗽 节点选择。`, {
      tag: DNS_OUTBOUND_TAG,
      keywords: settings.dns_urltest.keywords,
      fallback_detours: dnsDetourCount
    });
  } else {
    addStep('DNS 专用分组', 'success', `生成 ${DNS_OUTBOUND_TAG}，包含 ${dnsGroup.outbounds.length} 个节点；已将 ${dnsDetourCount} 个 DNS detour 路由至此组。`, {
      tag: DNS_OUTBOUND_TAG,
      nodes: dnsGroup.outbounds.length,
      detours: dnsDetourCount,
      urltest: settings.dns_urltest
    });
  }

  if (!settings.manual_selector.enabled) {
    addStep('手动选择组', 'warning', '🍭 手动选择组未启用。');
  } else if (!settings.manual_selector.keywords.length) {
    addStep('手动选择组', 'warning', '🍭 手动选择组未配置筛选关键词。');
  } else if (!manualSelectorGroup) {
    addStep('手动选择组', 'warning', '没有匹配手动选择关键词的节点。', { keywords: settings.manual_selector.keywords });
  } else {
    addStep('手动选择组', 'success', `生成 ${MANUAL_SELECTOR_OUTBOUND_TAG}，包含 ${manualSelectorGroup.outbounds.length} 个节点。`, {
      tag: MANUAL_SELECTOR_OUTBOUND_TAG,
      nodes: manualSelectorGroup.outbounds.length,
      keywords: settings.manual_selector.keywords
    });
  }

  const selectorCount = template.outbounds.filter((outbound: NodeLike) => outbound.type === 'selector').length;
  const directTag = template.outbounds.find((outbound: NodeLike) => outbound.type === 'direct')?.tag || '🎯 全球直连';
  let output: Record<string, any>;
  try {
    output = injectTemplate(template, nodes, groups, byRegion, directTag, settings, dnsGroup, manualSelectorGroup);
  } catch (error) {
    addStep('策略注入', 'error', `策略注入失败：${error instanceof Error ? error.message : 'inject_failed'}`, { selectors: selectorCount });
    abort(error instanceof Error ? error.message : 'inject_failed');
  }
  addStep('策略注入', 'success', `处理 ${selectorCount} 个 selector。`, { selectors: selectorCount });
  addStep('最终配置', 'success', `输出 ${output.outbounds.length} 个 outbound。`, { outbounds: output.outbounds.length });

  return {
    success: true,
    output,
    summary: {
      duration_ms: Date.now() - startedAt,
      template_id: profile.template_id,
      template_name: profile.template_name || profile.template_id,
      subscriptions: subscriptions.length,
      successful_subscriptions: successCount,
      warning_subscriptions: warningCount,
      failed_subscriptions: failedCount,
      raw_nodes: rawCount,
      nodes: nodes.length,
      groups: groups.length,
      dns_group_nodes: dnsGroup?.outbounds.length || 0,
      manual_selector_nodes: manualSelectorGroup?.outbounds.length || 0,
      dns_detours_adjusted: dnsDetourCount,
      selectors: selectorCount,
      outbounds: output.outbounds.length,
      warnings: steps.filter((step) => step.status === 'warning').length,
      reports,
      settings: {
        fetch_timeout_ms: settings.fetch_timeout_ms,
        max_subscription_bytes: settings.max_subscription_bytes,
        banned_pattern: settings.banned_pattern,
        urltest: settings.urltest,
        dns_urltest: settings.dns_urltest,
        manual_selector: settings.manual_selector
      }
    },
    steps
  };
}
