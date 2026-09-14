import { ref } from 'vue';
import type { GenerationSettings, RegionCode } from '@shared/types';
import { fetchGenerationSettings, updateGenerationSettings } from '../api/settings';

type ToastType = 'success' | 'error' | 'info';

type Hooks = {
  notify?: (message: string, type?: ToastType) => void;
  handleRequestError?: (error: unknown, fallback?: string) => void;
  ensureAuthed?: () => Promise<boolean>;
};

const regions: RegionCode[] = ['HK', 'TW', 'SG', 'JP', 'US'];

function formatKeywords(keywords: string[]) {
  return keywords.map((keyword) => /\s/.test(keyword) ? `"${keyword}"` : keyword).join(' ');
}

function parseKeywords(value: string) {
  return (value.match(/"[^"]*"|'[^']*'|[^\s,]+/g) || [])
    .map((item) => (/^(".*"|'.*')$/.test(item) ? item.slice(1, -1) : item).trim())
    .filter(Boolean);
}

const emptySettings = (): GenerationSettings & { updated_at?: string | null } => ({
  region_keywords: { HK: [], TW: [], SG: [], JP: [], US: [] },
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
  const keywordText = ref<Record<RegionCode, string>>({ HK: '', TW: '', SG: '', JP: '', US: '' });
  const dnsKeywordText = ref('');
  const manualSelectorKeywordText = ref('');

  const applySettings = (next: GenerationSettings & { updated_at?: string | null }) => {
    settings.value = next;
    keywordText.value = Object.fromEntries(regions.map((region) => [
      region,
      formatKeywords(next.region_keywords[region] || [])
    ])) as Record<RegionCode, string>;
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

  const updateKeyword = (region: RegionCode, value: string) => {
    keywordText.value = { ...keywordText.value, [region]: value };
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
        region_keywords: Object.fromEntries(regions.map((region) => [
          region,
          parseKeywords(keywordText.value[region])
        ])) as Record<RegionCode, string[]>,
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
    keywordText.value = { HK: '', TW: '', SG: '', JP: '', US: '' };
    dnsKeywordText.value = '';
    manualSelectorKeywordText.value = '';
  };

  return {
    regions,
    loading,
    saving,
    settings,
    keywordText,
    dnsKeywordText,
    manualSelectorKeywordText,
    refresh,
    updateKeyword,
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
