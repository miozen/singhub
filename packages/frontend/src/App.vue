<template>
  <main v-if="!isAuthed" class="auth-shell">
    <section class="auth-copy">
      <h1>SingHub</h1>
      <p>集中管理客户端、模板、订阅和生成参数。</p>
    </section>

    <form class="auth-card" @submit.prevent="login">
      <div class="auth-title">
        <h1>SingHub</h1>
        <p>配置管理中心</p>
      </div>

      <label for="admin-password">管理密码</label>
      <input
        id="admin-password"
        v-model="password"
        class="input"
        type="password"
        autocomplete="current-password"
        placeholder="请输入后台管理密码"
      />

      <button class="primary wide" :disabled="authLoading">
        {{ authLoading ? '登录中...' : '进入 SingHub' }}
      </button>
    </form>

    <ToastHost :items="toasts" />
  </main>

  <div v-else class="app-shell">
    <div v-if="menuOpen" class="sidebar-backdrop" @click="menuOpen = false"></div>
    <aside :class="{ open: menuOpen }">
      <div class="sidebar-brand">
        <strong>SingHub</strong>
        <span>配置管理中心</span>
      </div>

      <nav>
        <button
          v-for="item in navItems"
          :key="item.id"
          :class="{ active: currentPage === item.id }"
          :disabled="item.disabled"
          @click="selectPage(item.id, item.disabled)"
        >
          <span>{{ item.icon }}</span>{{ item.label }}
        </button>
      </nav>

      <div class="sidebar-user">
        <span class="avatar">A</span>
        <div>
          <strong>admin</strong>
          <small>管理员</small>
        </div>
        <button @click="logoutWithNotice" title="退出">退出</button>
      </div>
    </aside>

    <section class="workspace">
      <header>
        <button class="menu" @click="menuOpen = !menuOpen">☰</button>
        <div>
          <p class="eyebrow">{{ currentNav.eyebrow }}</p>
          <h2>{{ currentNav.title }}</h2>
        </div>
        <span class="status-dot">在线</span>
      </header>

      <section class="content">
        <ClientProfileWorkspace
          v-if="currentPage === 'clients'"
          :profiles="clientProfiles"
          :templates="templates"
          :subscriptions="subscriptions"
          :loading="clientProfilesLoading"
          :saving="clientProfileSaving"
          :modal-open="clientProfileModalOpen"
          :form="clientProfileForm"
          :toggling-ids="togglingClientProfileIds"
          :resetting-ids="resettingClientProfileIds"
          :generation-testing-ids="generationTestingClientProfileIds"
          :generation-run-loading-ids="clientProfileGenerationRunLoadingIds"
          :generation-reports="clientProfileGenerationReports"
          :generation-runs="clientProfileGenerationRuns"
          :deleting-id="deletingClientProfileId"
          @create="openCreateClient"
          @edit="openEditClientProfile"
          @delete="deleteClientProfileItem"
          @toggle="toggleClientProfileItem"
          @copy-link="copyClientProfileLink"
          @load-generation-runs="loadClientProfileGenerationRuns"
          @reset-token="resetClientProfileTokenItem"
          @test-generation="testClientProfileGenerationItem"
          @toggle-generation-report="toggleClientProfileGenerationReport"
          @save="saveClientProfile"
          @close-modal="closeClientProfileModal"
          @toggle-binding="toggleClientProfileBinding"
        />

        <TemplateWorkspace
          v-if="currentPage === 'templates'"
          :templates="templates"
          :current-id="currentId"
          :current-name="currentName"
          :raw-json="rawJson"
          :loading="loading"
          :saving="saving"
          :syntax-error="syntaxError"
          :is-dirty="isDirty"
          @create="openCreate"
          @select="selectTemplate"
          @clone="openClone"
          @delete="openDelete"
          @save="save"
          @copy-sub="copyCurrentLink"
          @set-syntax-error="setSyntaxError"
          @update:current-name="updateCurrentName"
          @update:raw-json="updateRawJson"
        />

        <SubscriptionWorkspace
          v-if="currentPage === 'subscriptions'"
          :subscriptions="subscriptions"
          :regions="regions"
          :loading="subscriptionsLoading"
          :saving="subscriptionSaving"
          :testing-draft="testingDraftSubscription"
          :modal-open="subscriptionModalOpen"
          :form="subscriptionForm"
          :draft-report="draftSubscriptionReport"
          :reports="subscriptionReports"
          :testing-ids="testingSubscriptionIds"
          :toggling-ids="togglingSubscriptionIds"
          :deleting-id="deletingSubscriptionId"
          @create="openCreateSubscription"
          @edit="openEditSubscription"
          @delete="deleteSubscriptionItem"
          @toggle="toggleSubscriptionItem"
          @test="testSubscriptionItem"
          @toggle-report="toggleSubscriptionReport"
          @test-draft="testDraftSubscription"
          @save="saveSubscription"
          @close-modal="closeSubscriptionModal"
        />

        <SettingsWorkspace
          v-if="currentPage === 'settings'"
          :regions="settingsRegions"
          :loading="settingsLoading"
          :saving="settingsSaving"
          :settings="generationSettings"
          :keyword-text="generationKeywordText"
          :dns-keyword-text="dnsKeywordText"
          :manual-selector-keyword-text="manualSelectorKeywordText"
          @save="saveGenerationSettings"
          @update-keyword="updateGenerationKeyword"
          @update-setting="updateGenerationSetting"
          @update-urltest="updateGenerationUrltest"
          @update-dns-urltest="updateDnsUrltest"
          @update-dns-keyword="updateDnsKeyword"
          @update-manual-selector-enabled="updateManualSelectorEnabled"
          @update-manual-selector-keyword="updateManualSelectorKeyword"
        />
      </section>
    </section>

    <ConfirmDialog
      v-if="modal.show"
      v-model:id="modal.id"
      v-model:name="modal.name"
      :title="modal.title"
      :confirm-text="modal.confirmText"
      :message="modal.message"
      :mode="modal.type === 'create' || modal.type === 'clone' ? 'form' : 'message'"
      @cancel="closeModal"
      @confirm="confirmModal"
    />

    <ToastHost :items="toasts" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import TemplateWorkspace from './components/TemplateWorkspace.vue';
import SubscriptionWorkspace from './components/SubscriptionWorkspace.vue';
import ClientProfileWorkspace from './components/ClientProfileWorkspace.vue';
import SettingsWorkspace from './components/SettingsWorkspace.vue';
import ToastHost from './components/ToastHost.vue';
import { getErrorMessage } from './api/errors';
import { useAdminSession } from './composables/useAdminSession';
import { useTemplateManager } from './composables/useTemplateManager';
import { useSubscriptionManager } from './composables/useSubscriptionManager';
import { useClientProfileManager } from './composables/useClientProfileManager';
import { useGenerationSettingsManager } from './composables/useGenerationSettingsManager';

type ToastType = 'success' | 'error' | 'info';

type NavItem = {
  id: string;
  label: string;
  icon: string;
  title: string;
  eyebrow: string;
  disabled?: boolean;
};

const navItems: NavItem[] = [
  { id: 'clients', label: '客户端链接', icon: '◈', title: '客户端链接', eyebrow: 'SINGHUB / CLIENTS' },
  { id: 'templates', label: '模板管理', icon: '◇', title: '模板管理', eyebrow: 'SINGHUB / TEMPLATES' },
  { id: 'subscriptions', label: '订阅源', icon: '◎', title: '订阅源', eyebrow: 'SINGHUB / SOURCES' },
  { id: 'settings', label: '系统设置', icon: '⚙', title: '系统设置', eyebrow: 'SINGHUB / SETTINGS' }
];

const toasts = ref<{ id: number; message: string; type: ToastType }[]>([]);
const currentPage = ref('clients');
const menuOpen = ref(false);
let toastId = 0;

const currentNav = computed(() => navItems.find((item) => item.id === currentPage.value) || navItems[0]);
const showToast = (message: string, type: ToastType = 'info') => {
  const id = toastId++;
  toasts.value.push({ id, message, type });
  setTimeout(() => {
    toasts.value = toasts.value.filter((toast) => toast.id !== id);
  }, 3000);
};

const {
  password,
  authLoading,
  isAuthed,
  initializeSession,
  login,
  logout,
  handleAuthError
} = useAdminSession({
  notify: showToast,
  onLoginSuccess: async () => {
    try {
      await Promise.all([refreshList({ autoLoadFirst: false }), refreshSubscriptionList(), refreshClientProfileList()]);
    } catch (error) {
      if (handleAuthError(error)) return;
      throw error;
    }
  },
  onLogout: () => {
    resetShellState();
  }
});

const handleRequestError = (error: unknown, fallback = '操作失败') => {
  if (handleAuthError(error)) return;
  showToast(getErrorMessage(error, fallback), 'error');
};

const templateManager = useTemplateManager({
  notify: showToast,
  handleRequestError,
  ensureAuthed: async () => {
    if (isAuthed.value) return true;
    showToast('请先登录', 'error');
    return false;
  }
});

const {
  templates,
  currentId,
  currentName,
  rawJson,
  loading,
  saving,
  syntaxError,
  modal,
  isDirty,
  setSyntaxError,
  resetCurrentTemplate,
  refreshList,
  selectTemplate,
  save,
  openCreate,
  openClone,
  openDelete,
  closeModal,
  confirmModal,
  copyCurrentSubLink,
} = templateManager;

const subscriptionManager = useSubscriptionManager({
  notify: showToast,
  handleRequestError,
  ensureAuthed: async () => {
    if (isAuthed.value) return true;
    showToast('请先登录', 'error');
    return false;
  }
});

const {
  regions,
  subscriptions,
  loading: subscriptionsLoading,
  saving: subscriptionSaving,
  testingDraft: testingDraftSubscription,
  modalOpen: subscriptionModalOpen,
  form: subscriptionForm,
  draftReport: draftSubscriptionReport,
  reports: subscriptionReports,
  testingIds: testingSubscriptionIds,
  togglingIds: togglingSubscriptionIds,
  deletingId: deletingSubscriptionId,
  refreshList: refreshSubscriptionList,
  openCreate: openCreateSubscription,
  openEdit: openEditSubscription,
  closeModal: closeSubscriptionModal,
  save: saveSubscription,
  remove: deleteSubscriptionItem,
  toggle: toggleSubscriptionItem,
  testSaved: testSubscriptionItem,
  testDraft: testDraftSubscription,
  toggleReport: toggleSubscriptionReport
} = subscriptionManager;

const clientProfileManager = useClientProfileManager({
  notify: showToast,
  handleRequestError,
  ensureAuthed: async () => {
    if (isAuthed.value) return true;
    showToast('请先登录', 'error');
    return false;
  }
});

const {
  profiles: clientProfiles,
  loading: clientProfilesLoading,
  saving: clientProfileSaving,
  modalOpen: clientProfileModalOpen,
  form: clientProfileForm,
  togglingIds: togglingClientProfileIds,
  resettingIds: resettingClientProfileIds,
  generationTestingIds: generationTestingClientProfileIds,
  generationRunLoadingIds: clientProfileGenerationRunLoadingIds,
  generationReports: clientProfileGenerationReports,
  generationRuns: clientProfileGenerationRuns,
  deletingId: deletingClientProfileId,
  refreshList: refreshClientProfileList,
  openEdit: openEditClientProfile,
  closeModal: closeClientProfileModal,
  save: saveClientProfile,
  remove: deleteClientProfileItem,
  toggle: toggleClientProfileItem,
  resetToken: resetClientProfileTokenItem,
  copyLink: copyClientProfileLink,
  loadGenerationRuns: loadClientProfileGenerationRuns,
  testGeneration: testClientProfileGenerationItem,
  toggleGenerationReport: toggleClientProfileGenerationReport,
  toggleBinding: toggleClientProfileBinding
} = clientProfileManager;

const settingsManager = useGenerationSettingsManager({
  notify: showToast,
  handleRequestError,
  ensureAuthed: async () => {
    if (isAuthed.value) return true;
    showToast('请先登录', 'error');
    return false;
  }
});

const {
  regions: settingsRegions,
  loading: settingsLoading,
  saving: settingsSaving,
  settings: generationSettings,
  keywordText: generationKeywordText,
  dnsKeywordText,
  manualSelectorKeywordText,
  refresh: refreshGenerationSettings,
  updateKeyword: updateGenerationKeyword,
  updateSetting: updateGenerationSetting,
  updateUrltest: updateGenerationUrltest,
  updateDnsUrltest,
  updateDnsKeyword,
  updateManualSelectorEnabled,
  updateManualSelectorKeyword,
  save: saveGenerationSettings
} = settingsManager;

const openCreateClient = async () => {
  if (!templates.value.length) await refreshList({ autoLoadFirst: false });
  if (!subscriptions.value.length) await refreshSubscriptionList();
  clientProfileManager.openCreate(templates.value, subscriptions.value);
};

const resetShellState = () => {
  templateManager.templates.value = [];
  subscriptionManager.reset();
  clientProfileManager.reset();
  settingsManager.reset();
  resetCurrentTemplate();
  currentPage.value = 'clients';
  menuOpen.value = false;
};

const logoutWithNotice = () => {
  logout({ message: '已退出登录', type: 'info' });
};

const selectPage = async (id: string, disabled = false) => {
  if (disabled) {
    showToast('该模块暂未启用', 'info');
    return;
  }
  currentPage.value = id;
  menuOpen.value = false;
  if ((id === 'subscriptions' || id === 'clients') && !subscriptions.value.length) {
    await refreshSubscriptionList();
  }
  if (id === 'clients' && !clientProfiles.value.length) {
    await refreshClientProfileList();
  }
  if (id === 'settings') {
    await refreshGenerationSettings();
  }
};

const copyCurrentLink = async () => {
  await copyCurrentSubLink();
};

const updateCurrentName = (value: string) => {
  currentName.value = value;
};

const updateRawJson = (value: string) => {
  rawJson.value = value;
};

onMounted(async () => {
  initializeSession();
  if (!isAuthed.value) return;
  await Promise.all([refreshList({ autoLoadFirst: false }), refreshSubscriptionList(), refreshClientProfileList()]).catch((error) => handleRequestError(error, '初始化失败'));
});
</script>

<style>
:root {
  color-scheme: dark;
  --bg: #02040a;
  --surface: #07101a;
  --panel: #0c1622;
  --panel-soft: #101c2b;
  --line: #223044;
  --text: #edf6ff;
  --muted: #8a9aae;
  --cyan: #46d9d1;
  --blue: #5aa7ff;
  --red: #ff6876;
}

* { box-sizing: border-box; }
html, body, #app { min-height: 100%; }
body {
  margin: 0;
  background: #000;
  color: var(--text);
  font: 14px/1.5 Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
button, input, select, textarea { font: inherit; }
button { cursor: pointer; }
button:disabled { opacity: .48; cursor: not-allowed; }

.eyebrow { margin: 0; color: var(--cyan); font-size: 11px; font-weight: 800; letter-spacing: .14em; }
.muted { color: var(--muted); }
.mono { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }

.auth-shell {
  min-height: 100vh;
  display: grid;
  grid-template-columns: minmax(280px, 520px) minmax(320px, 380px);
  align-items: center;
  justify-content: center;
  gap: 72px;
  padding: 32px;
  background: #000;
}
.auth-copy h1 { margin: 0 0 12px; font-size: clamp(46px, 7vw, 80px); line-height: 1; }
.auth-copy p { margin: 0; max-width: 430px; color: var(--muted); font-size: 17px; }
.auth-card {
  width: min(380px, 100%);
  padding: 28px;
  border: 1px solid #1d2939;
  border-radius: 10px;
  background: #070b10;
  box-shadow: 0 24px 80px #000;
}
.auth-title { margin-bottom: 22px; }
.auth-title h1 { margin: 0; font-size: 28px; line-height: 1.1; }
.auth-title p { margin: 6px 0 0; color: var(--muted); }
.auth-card .input { margin-bottom: 16px; }
label { display: grid; gap: 7px; color: #b5c2d2; font-weight: 600; margin: 14px 0; }
.input, .title-input, .modal input, .modal textarea, .modal select, .client-modal select {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #07101a;
  color: var(--text);
  padding: 10px 12px;
  outline: none;
}
.input:focus, .title-input:focus, .modal input:focus, .modal textarea:focus, .modal select:focus {
  border-color: var(--cyan);
  box-shadow: 0 0 0 3px #46d9d11a;
}
.form-note { color: var(--muted); margin-bottom: 0; }

.primary, .ghost, .danger, .mini, .danger-mini {
  border: 1px solid var(--line);
  border-radius: 8px;
  padding: 8px 11px;
  white-space: nowrap;
}
.primary { border: 0 !important; background: linear-gradient(135deg, var(--cyan), var(--blue)) !important; color: #041b20 !important; font-weight: 800; }
.ghost, .mini { background: #121f30; color: #c8d8ea; }
.danger, .danger-mini { border-color: #6c3038 !important; background: #27151a; color: #ff9aa3 !important; }
.wide { width: 100%; padding: 12px; }
.mini, .danger-mini { padding: 5px 7px; font-size: 12px; }

.app-shell { min-height: 100vh; display: grid; grid-template-columns: 240px minmax(0, 1fr); background: var(--bg); }
aside { position: sticky; top: 0; height: 100vh; padding: 20px 14px; border-right: 1px solid var(--line); background: #060b12; display: flex; flex-direction: column; }
.sidebar-brand { display: grid; gap: 3px; padding: 0 10px 22px; }
.sidebar-brand strong { font-size: 20px; line-height: 1.1; }
.sidebar-brand span { color: var(--muted); font-size: 12px; }
nav { display: grid; gap: 4px; }
nav button { display: flex; align-items: center; gap: 12px; border: 0; border-radius: 8px; background: transparent; color: #92a1b5; padding: 10px 12px; text-align: left; }
nav button:hover, nav button.active { color: var(--text); background: #101b29; }
nav button.active { box-shadow: inset 3px 0 var(--cyan); }
.sidebar-user { margin-top: auto; border-top: 1px solid var(--line); padding: 16px 4px 0; display: flex; align-items: center; gap: 10px; }
.avatar { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 50%; background: #142d3a; color: var(--cyan); font-weight: 800; }
.sidebar-user div { flex: 1; }
.sidebar-user strong, .sidebar-user small { display: block; }
.sidebar-user small { color: var(--muted); }
.sidebar-user button { border: 0; background: transparent; color: var(--muted); }

.workspace { min-width: 0; height: 100vh; display: grid; grid-template-rows: 72px minmax(0, 1fr); }
.workspace > header { height: 72px; padding: 0 28px; display: flex; align-items: center; border-bottom: 1px solid var(--line); background: #050a11; }
.workspace > header h2 { margin: 2px 0 0; font-size: 20px; }
.status-dot { margin-left: auto; color: #8ce6a8; font-size: 12px; }
.menu { display: none; }
.content { min-height: 0; padding: 20px 24px; overflow: auto; }

.workspace-grid { display: grid; gap: 16px; min-height: 0; }
.split { grid-template-columns: minmax(270px, 340px) minmax(0, 1fr); height: calc(100vh - 112px); }
.template-editor-panel { height: calc(100vh - 112px); }
.panel { min-height: 0; border: 1px solid var(--line); border-radius: 10px; background: var(--panel); padding: 16px; }
.panel-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 14px; }
.panel-head h3, .panel-head h4 { margin: 0; }
.compact-head { align-items: flex-start; }
.panel-list { display: grid; grid-template-rows: auto minmax(180px, 1fr) auto; gap: 14px; overflow: hidden; }
.panel-editor { display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 12px; padding: 0; overflow: hidden; }
.editor-toolbar { display: grid; grid-template-columns: minmax(150px, 210px) minmax(170px, 240px) minmax(360px, 1fr); align-items: end; gap: 10px; padding: 12px; border-bottom: 1px solid var(--line); background: #0a1320; }
.template-select-field { margin: 0; }
.template-toolbar .toolbar-actions { flex-wrap: nowrap; justify-content: flex-end; overflow-x: auto; padding-bottom: 1px; }
.template-toolbar .toolbar-actions button, .template-toolbar .status-pill { flex: 0 0 auto; }
.template-toolbar .input, .template-toolbar .title-input { min-width: 0; padding: 8px 10px; }
.inline-name { margin: 0; }
.toolbar-actions, .actions { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: wrap; }
.editor-wrap { position: relative; min-height: 0; border: 0; background: #08111b; overflow: hidden; }
.editor, .center, .overlay { position: absolute; inset: 0; }
.center, .overlay { display: grid; place-items: center; color: var(--muted); background: #08111bea; z-index: 2; }

.status-pill, .badge { border: 1px solid var(--line); border-radius: 999px; padding: 3px 8px; color: var(--muted); font-size: 12px; line-height: 1.4; }
.status-pill.success, .badge.active { border-color: #22c55e; color: #bbf7d0; background: rgba(22, 101, 52, .28); }
.status-pill.error { border-color: #ef4444; color: #fecaca; background: rgba(127, 29, 29, .4); }

.sidebar__list, .source-list, .client-list, .version-list, .settings-grid { display: grid; gap: 10px; align-content: start; }
.sidebar__list { overflow: auto; padding-right: 2px; }
.template-item, .source-card, .client-card, .version-item, .settings-section, .binding-picker, .binding-row, .generation-steps article, .run-list article {
  border: 1px solid #243041;
  border-radius: 8px;
  background: #08111b;
}
.template-item { padding: 11px; color: inherit; cursor: pointer; }
.template-item.active { border-color: var(--cyan); background: #102331; }
.template-item__row, .source-card, .client-card, .version-item { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 12px; }
.template-item__row { display: flex; align-items: center; justify-content: space-between; }
.template-item__name { font-weight: 700; }
.template-item__id, code { color: var(--muted); word-break: break-all; }
.template-item__ops, .binding-actions { display: flex; gap: 6px; }
.version-section { border-top: 1px solid var(--line); padding-top: 14px; overflow: auto; }
.version-section__head, .report-heading, .binding-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.version-section__head h4, .binding-head h4, .section-title h4 { margin: 0; }
.version-item { padding: 11px; }
.version-item__meta { min-width: 0; display: grid; gap: 4px; }
.version-item__title, .source-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.empty { text-align: center; color: var(--muted); padding: 30px 0; }

.subscription-page, .client-page, .settings-page { display: grid; gap: 16px; }
.source-card, .client-card { padding: 14px; }
.source-main, .source-actions, .client-main { min-width: 0; display: grid; gap: 9px; }
.source-actions { justify-items: end; }
.source-title i { width: 9px; height: 9px; border-radius: 50%; background: #64748b; }
.source-title i.on { background: #63d58b; box-shadow: 0 0 14px #63d58b88; }
.chips, .bound-list { display: flex; flex-wrap: wrap; gap: 6px; }
.chips span, .bound-list span { border: 1px solid #2c3c52; border-radius: 999px; padding: 3px 8px; color: #bdd0e5; background: #111e2e; font-size: 12px; }
.inline-switch { margin: 0; display: flex; align-items: center; justify-content: flex-end; gap: 8px; }
.switch { width: 42px; height: 23px; border: 1px solid var(--line); border-radius: 999px; padding: 2px; background: #1d2939; }
.switch i { display: block; width: 17px; height: 17px; border-radius: 50%; background: #94a3b8; transition: transform .18s ease, background .18s ease; }
.switch.on { border-color: #22c55e; background: #14532d; }
.switch.on i { transform: translateX(18px); background: #bbf7d0; }

.generation-report, .test-report { grid-column: 1 / -1; display: grid; gap: 10px; padding: 12px; border: 1px solid #315c48; border-radius: 8px; background: #0e2019; color: #d7fbe5; }
.generation-report.error, .test-report.error { border-color: #6c3038; background: #27151a; color: #fecaca; }
.generation-steps, .run-history, .run-list { display: grid; gap: 8px; }
.generation-steps article, .run-list article { padding: 9px; }
.run-history { grid-column: 1 / -1; margin-top: 8px; padding-top: 10px; border-top: 1px solid rgba(148, 163, 184, .22); }
.run-summary { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; align-items: center; gap: 8px; width: 100%; padding: 0; border: 0; background: transparent; color: inherit; text-align: left; }
.run-summary small { min-width: 0; color: var(--muted); }
.run-summary b { color: var(--cyan); font-size: 12px; }
.run-details { display: grid; gap: 8px; margin-top: 9px; }
.run-list em { width: fit-content; color: #fbbf24; font-style: normal; font-size: 12px; }
.run-list p { margin: 0; color: #fecaca; font-size: 12px; }
.qr-modal { width: min(420px, 100%); }
.qr-preview { display: grid; place-items: center; min-height: 300px; padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: #fff; }
.qr-preview img { display: block; width: min(300px, 100%); height: auto; image-rendering: pixelated; }

.settings-section { display: grid; gap: 12px; padding: 14px; }
.settings-form { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.settings-form.compact { grid-template-columns: minmax(240px, 1fr) repeat(2, minmax(120px, 180px)); }
.keyword-rows { display: grid; gap: 10px; }
.keyword-rows label { display: grid; grid-template-columns: 110px minmax(0, 1fr); align-items: center; gap: 12px; margin: 0; }
.settings-form label, .keyword-rows label { display: grid; gap: 8px; margin: 0; }
.settings-form span, .keyword-rows span { color: var(--muted); font-size: 13px; }
.settings-form textarea, .settings-form input, .keyword-rows textarea, .binding-row textarea {
  width: 100%; border: 1px solid var(--line); border-radius: 8px; background: #07101a; color: var(--text); padding: 10px 12px; outline: none;
}
.keyword-rows textarea { resize: vertical; min-height: 62px; }
.full-width { grid-column: 1 / -1; }

.modal-backdrop { position: fixed; inset: 0; z-index: 30; display: grid; place-items: center; padding: 20px; background: #000b; }
.modal { width: min(520px, 100%); max-height: min(88vh, 880px); overflow: auto; padding: 22px; border: 1px solid var(--line); border-radius: 12px; background: #0b1420; display: grid; gap: 14px; }
.modal h3 { margin: 0; font-size: 20px; line-height: 1.2; }
.client-modal { width: min(760px, 100%); gap: 7px; padding: 16px; }
.client-modal .panel-head { margin-bottom: 2px; }
.client-modal label { margin: 4px 0; gap: 4px; }
.client-modal .input, .client-modal input, .client-modal select { padding: 7px 9px; }
.client-modal .binding-picker { margin-top: 2px; }
.modal-body, .modal-actions { display: grid; gap: 12px; }
.modal-actions { grid-template-columns: 1fr 1fr; }
.subscription-modal fieldset { margin: 0; padding: 12px; border: 1px solid var(--line); border-radius: 8px; display: flex; flex-wrap: wrap; gap: 10px 16px; }
.subscription-modal legend { color: #b5c2d2; font-weight: 700; padding: 0 6px; }
.check-row { margin: 0; display: flex; align-items: center; gap: 8px; }
.check-row input { width: auto; }
.binding-picker { display: grid; gap: 8px; padding: 10px; }
.binding-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 6px; }
.binding-row { display: block; padding: 7px 8px; }
.binding-row.check-row { display: flex; gap: 8px; }
.binding-row.active { border-color: #2f8a90; background: #102331; }
.binding-row textarea { grid-column: 1 / -1; min-height: 76px; resize: vertical; }
.compact-empty { padding: 16px 0; }

.toast-stack { position: fixed; top: 16px; left: 50%; transform: translateX(-50%); display: grid; gap: 8px; z-index: 40; }
.toast { padding: 10px 14px; border-radius: 999px; background: #173126; color: #fff; border: 1px solid #3c765c; }
.toast.success { background: #14532d; border-color: #1e7a43; }
.toast.error { background: #3b1c25; border-color: #7a3745; }
.toast.info { background: #163249; border-color: #305f87; }

@media (max-width: 1180px) {
  .split { grid-template-columns: 1fr; height: auto; }
  .panel-editor { min-height: 680px; }
  .editor-toolbar { grid-template-columns: minmax(140px, 190px) minmax(150px, 210px) minmax(320px, 1fr); }
  .settings-form.compact { grid-template-columns: 1fr; }
  .keyword-rows label { grid-template-columns: 1fr; gap: 6px; }
}
@media (max-width: 760px) {
  .auth-shell { grid-template-columns: 1fr; gap: 28px; padding: 24px; justify-items: stretch; }
  .auth-copy h1 { font-size: 40px; }
  .app-shell { display: block; }
  .sidebar-backdrop { position: fixed; inset: 0; z-index: 19; background: rgba(0, 0, 0, .5); }
  aside { position: fixed; left: -270px; z-index: 20; width: 240px; transition: .2s; }
  aside.open { left: 0; box-shadow: 20px 0 60px #000; }
  .workspace { height: 100vh; }
  .workspace > header { height: 66px; padding: 0 16px; }
  .menu { display: block; margin-right: 12px; border: 0; background: transparent; color: white; font-size: 20px; }
  .content { padding: 14px; }
  .status-dot { display: none; }
  .editor-toolbar, .source-card, .client-card, .template-item__row, .version-item { grid-template-columns: 1fr; }
  .binding-grid { grid-template-columns: 1fr; }
  .toolbar-actions, .source-actions, .inline-switch { justify-content: flex-start; justify-items: start; }
  .panel-editor { min-height: 620px; }
}
@media (min-width: 761px) {
  .sidebar-backdrop { display: none; }
}
@media (max-width: 430px) {
  .auth-card { padding: 24px; }
  .modal-actions { grid-template-columns: 1fr; }
}
</style>
