import { computed, ref } from 'vue';
import type { SubscriptionPayload, SubscriptionRecord, SubscriptionTestReport } from '@shared/types';
import {
  createSubscription,
  deleteSubscription,
  fetchSubscriptionList,
  setSubscriptionEnabled,
  testDraftSubscription,
  testSavedSubscription,
  updateSubscription
} from '../api/subscriptions';

const DEFAULT_REGIONS = ['HK', 'TW', 'SG', 'JP', 'US'];
type ToastType = 'success' | 'error' | 'info';

type Hooks = {
  notify?: (message: string, type?: ToastType) => void;
  handleRequestError?: (error: unknown, fallback?: string) => void;
  ensureAuthed?: () => Promise<boolean>;
};

const emptyForm = (allowedRegions = DEFAULT_REGIONS): SubscriptionPayload & { id?: string } => ({
  name: '',
  url: '',
  enabled: true,
  allowed_regions: [...allowedRegions]
});

export function useSubscriptionManager(hooks: Hooks = {}) {
  const subscriptions = ref<SubscriptionRecord[]>([]);
  const loading = ref(false);
  const saving = ref(false);
  const testingDraft = ref(false);
  const modalOpen = ref(false);
  const form = ref(emptyForm());
  const draftReport = ref<SubscriptionTestReport | null>(null);
  const reports = ref<Record<string, SubscriptionTestReport & { tested_at: string; expanded: boolean }>>({});
  const testingIds = ref<Record<string, boolean>>({});
  const togglingIds = ref<Record<string, boolean>>({});
  const deletingId = ref('');

  const enabledCount = computed(() => subscriptions.value.filter((item) => item.enabled).length);

  const reset = () => {
    subscriptions.value = [];
    reports.value = {};
    modalOpen.value = false;
    form.value = emptyForm();
    draftReport.value = null;
  };

  const refreshList = async () => {
    loading.value = true;
    try {
      subscriptions.value = await fetchSubscriptionList();
    } catch (error) {
      hooks.handleRequestError?.(error, '加载订阅源失败');
    } finally {
      loading.value = false;
    }
  };

  const openCreate = (allowedRegions?: string[]) => {
    form.value = emptyForm(allowedRegions);
    draftReport.value = null;
    modalOpen.value = true;
  };

  const openEdit = (subscription: SubscriptionRecord) => {
    form.value = JSON.parse(JSON.stringify(subscription));
    draftReport.value = null;
    modalOpen.value = true;
  };

  const closeModal = () => {
    modalOpen.value = false;
    draftReport.value = null;
  };

  const validateForm = () => {
    if (!form.value.name.trim()) return '订阅源名称不能为空';
    if (!/^https?:\/\//i.test(form.value.url)) return '订阅源 URL 格式不正确';
    if (form.value.enabled && !form.value.allowed_regions.length) return '启用的订阅源至少选择一个区域';
    return '';
  };

  const save = async () => {
    const error = validateForm();
    if (error) {
      hooks.notify?.(error, 'error');
      return;
    }
    if (!(await hooks.ensureAuthed?.())) return;
    saving.value = true;
    try {
      const payload = {
        name: form.value.name.trim(),
        url: form.value.url.trim(),
        enabled: form.value.enabled,
        allowed_regions: [...form.value.allowed_regions]
      };
      if (form.value.id) await updateSubscription(form.value.id, payload);
      else await createSubscription(payload);
      closeModal();
      await refreshList();
      hooks.notify?.('订阅源已保存', 'success');
    } catch (error) {
      hooks.handleRequestError?.(error, '保存订阅源失败');
    } finally {
      saving.value = false;
    }
  };

  const remove = async (subscription: SubscriptionRecord) => {
    if (!window.confirm(`确认删除订阅源 ${subscription.name} ?`)) return;
    if (!(await hooks.ensureAuthed?.())) return;
    deletingId.value = subscription.id;
    try {
      await deleteSubscription(subscription.id);
      const { [subscription.id]: _removed, ...remaining } = reports.value;
      reports.value = remaining;
      await refreshList();
      hooks.notify?.('订阅源已删除', 'info');
    } catch (error) {
      hooks.handleRequestError?.(error, '删除订阅源失败');
    } finally {
      deletingId.value = '';
    }
  };

  const toggle = async (subscription: SubscriptionRecord) => {
    if (!(await hooks.ensureAuthed?.())) return;
    const next = !subscription.enabled;
    togglingIds.value = { ...togglingIds.value, [subscription.id]: true };
    try {
      const result = await setSubscriptionEnabled(subscription.id, next);
      subscription.enabled = result.enabled;
      hooks.notify?.(result.enabled ? '订阅源已启用' : '订阅源已停用', 'info');
    } catch (error) {
      hooks.handleRequestError?.(error, '切换订阅源状态失败');
    } finally {
      togglingIds.value = { ...togglingIds.value, [subscription.id]: false };
    }
  };

  const testSaved = async (subscription: SubscriptionRecord) => {
    testingIds.value = { ...testingIds.value, [subscription.id]: true };
    try {
      const report = await testSavedSubscription(subscription.id);
      reports.value = {
        ...reports.value,
        [subscription.id]: { ...report, tested_at: new Date().toISOString(), expanded: true }
      };
      hooks.notify?.(report.success ? '订阅源测试完成' : report.error || '订阅源测试失败', report.success ? 'success' : 'error');
    } catch (error) {
      hooks.handleRequestError?.(error, '订阅源测试失败');
    } finally {
      testingIds.value = { ...testingIds.value, [subscription.id]: false };
    }
  };

  const testDraft = async () => {
    if (!form.value.url) {
      hooks.notify?.('请先填写订阅 URL', 'error');
      return;
    }
    testingDraft.value = true;
    draftReport.value = null;
    try {
      draftReport.value = await testDraftSubscription(form.value);
      hooks.notify?.(draftReport.value.success ? '订阅源测试完成' : draftReport.value.error || '订阅源测试失败', draftReport.value.success ? 'success' : 'error');
    } catch (error) {
      hooks.handleRequestError?.(error, '订阅源测试失败');
    } finally {
      testingDraft.value = false;
    }
  };

  const toggleReport = (subscription: SubscriptionRecord) => {
    const report = reports.value[subscription.id];
    if (!report) return;
    reports.value = { ...reports.value, [subscription.id]: { ...report, expanded: !report.expanded } };
  };

  const updateAllowedRegions = (regions: string[]) => {
    form.value.allowed_regions = regions;
  };

  return {
    regions: DEFAULT_REGIONS,
    subscriptions,
    loading,
    saving,
    testingDraft,
    modalOpen,
    form,
    draftReport,
    reports,
    testingIds,
    togglingIds,
    deletingId,
    enabledCount,
    reset,
    refreshList,
    openCreate,
    openEdit,
    closeModal,
    save,
    remove,
    toggle,
    testSaved,
    testDraft,
    toggleReport,
    updateAllowedRegions
  };
}
