import { ref } from 'vue';
import type { GenerationSettings } from '@shared/types';
import { fetchGenerationSettings, updateGenerationSettings } from '../api/settings';

type ToastType = 'success' | 'error' | 'info';

type Hooks = {
  notify?: (message: string, type?: ToastType) => void;
  handleRequestError?: (error: unknown, fallback?: string) => void;
  ensureAuthed?: () => Promise<boolean>;
};


function formatKeywords(keywords: string[]) {
  return keywords.map((keyword) => /\s/.test(keyword) ? `"${keyword}"` : keyword).join(' ');
}

function parseKeywords(value: string) {
  return (value.match(/"[^"]*"|'[^']*'|[^\s,]+/g) || [])
    .map((item) => (/^(".*"|'.*')$/.test(item) ? item.slice(1, -1) : item).trim())
    .filter(Boolean);
}

const emptySettings = (): GenerationSettings & { updated_at?: string | null } => ({
  regions: [],
  banned_pattern: '',
  subscription_user_agent: '',
  fetch_timeout_ms: 10000,
  max_subscription_bytes: 5000000,
  urltest: { url: '', interval: '', tolerance: 150 },
  dns_urltest: { enabled: false, keywords: [], url: '', interval: '', tolerance: 150 },
  manual_selector: { enabled: false, keywords: [] },
  updated_at: null
});

export function useGenerationSettingsManager(hooks: Hooks = {}) {
  const loading = ref(false);
  const saving = ref(false);
  const settings = ref(emptySettings());
  const keywordText = ref<Record<string, string>>({});
  const dnsKeywordText = ref('');
  const manualSelectorKeywordText = ref('');

  const applySettings = (next: GenerationSettings & { updated_at?: string | null }) => {
    settings.value = next;
    keywordText.value = Object.fromEntries(next.regions.map((region) => [region.id, formatKeywords(region.keywords)]));
    dnsKeywordText.value = formatKeywords(next.dns_urltest.keywords || []);
    manualSelectorKeywordText.value = formatKeywords(next.manual_selector.keywords || []);
  };

  const refresh = async () => {
    loading.value = true;
    try {
      applySettings(await fetchGenerationSettings());
    } catch (error) {
      hooks.handleRequestError?.(error, '加载系统设置失败');
    } finally {
      loading.value = false;
    }
  };

  const updateKeyword = (region: string, value: string) => {
    keywordText.value = { ...keywordText.value, [region]: value };
  };

  const addRegion = () => {
    const id = window.prompt('区域 ID（2-16 位大写字母、数字、_ 或 -；创建后不可修改）', '')?.trim().toUpperCase() || '';
    if (!/^[A-Z0-9_-]{2,16}$/.test(id) || settings.value.regions.some((region) => region.id === id)) {
      hooks.notify?.('区域 ID 无效或已存在', 'error');
      return;
    }
    settings.value = { ...settings.value, regions: [...settings.value.regions, { id, name: id, emoji: '🌐', enabled: true, keywords: [] }] };
    keywordText.value = { ...keywordText.value, [id]: '' };
  };
  const removeRegion = (id: string) => {
    if (!window.confirm(`删除区域 ${id}？若订阅或模板仍引用它，保存将被服务器拒绝。`)) return;
    settings.value = { ...settings.value, regions: settings.value.regions.filter((region) => region.id !== id) };
    const { [id]: _removed, ...remaining } = keywordText.value;
    keywordText.value = remaining;
  };
  const updateRegion = (id: string, key: 'name' | 'emoji' | 'enabled', value: string | boolean) => {
    settings.value = { ...settings.value, regions: settings.value.regions.map((region) => region.id === id ? { ...region, [key]: value } : region) };
  };

  const updateSetting = (key: 'banned_pattern' | 'subscription_user_agent' | 'fetch_timeout_ms' | 'max_subscription_bytes', value: string | number) => {
    settings.value = { ...settings.value, [key]: value };
  };

  const updateUrltest = (key: 'url' | 'interval' | 'tolerance', value: string | number) => {
    settings.value = {
      ...settings.value,
      urltest: { ...settings.value.urltest, [key]: value }
    };
  };

  const updateDnsUrltest = (key: 'enabled' | 'url' | 'interval' | 'tolerance', value: boolean | string | number) => {
    settings.value = {
      ...settings.value,
      dns_urltest: { ...settings.value.dns_urltest, [key]: value }
    };
  };

  const updateDnsKeyword = (value: string) => {
    dnsKeywordText.value = value;
  };

  const updateManualSelectorEnabled = (enabled: boolean) => {
    settings.value = { ...settings.value, manual_selector: { ...settings.value.manual_selector, enabled } };
  };

  const updateManualSelectorKeyword = (value: string) => {
    manualSelectorKeywordText.value = value;
  };

  const save = async () => {
    if (hooks.ensureAuthed && !(await hooks.ensureAuthed())) return;
    saving.value = true;
    try {
      const payload: GenerationSettings = {
        ...settings.value,
        regions: settings.value.regions.map((region) => ({ ...region, keywords: parseKeywords(keywordText.value[region.id] || '') })),
        dns_urltest: {
          ...settings.value.dns_urltest,
          keywords: parseKeywords(dnsKeywordText.value)
        },
        manual_selector: {
          ...settings.value.manual_selector,
          keywords: parseKeywords(manualSelectorKeywordText.value)
        }
      };
      applySettings(await updateGenerationSettings(payload));
      hooks.notify?.('系统设置已保存', 'success');
    } catch (error) {
      hooks.handleRequestError?.(error, '保存系统设置失败');
    } finally {
      saving.value = false;
    }
  };

  const reset = () => {
    settings.value = emptySettings();
    keywordText.value = {};
    dnsKeywordText.value = '';
    manualSelectorKeywordText.value = '';
  };

  return {
    loading,
    saving,
    settings,
    keywordText,
    dnsKeywordText,
    manualSelectorKeywordText,
    refresh,
    updateKeyword,
    addRegion,
    removeRegion,
    updateRegion,
    updateSetting,
    updateUrltest,
    updateDnsUrltest,
    updateDnsKeyword,
    updateManualSelectorEnabled,
    updateManualSelectorKeyword,
    save,
    reset
  };
}
