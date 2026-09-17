<template>
  <section class="subscription-page">
    <div class="panel">
      <div class="panel-head">
        <div>
          <h3>我的订阅</h3>
        </div>
        <button class="primary" @click="$emit('create')">添加订阅</button>
      </div>

      <div v-if="loading" class="empty">订阅源加载中...</div>
      <div v-else-if="!subscriptions.length" class="empty">尚未添加订阅源</div>
      <div v-else class="source-list">
        <article v-for="sub in subscriptions" :key="sub.id" class="source-card">
          <div class="source-main">
            <div class="source-title">
              <i :class="{ on: sub.enabled }"></i>
              <strong>{{ sub.name }}</strong>
              <span class="badge" :class="{ active: sub.enabled }">{{ sub.enabled ? '已启用' : '已停用' }}</span>
            </div>
            <code>{{ maskUrl(sub.url) }}</code>
            <div class="chips">
              <span v-for="region in sub.allowed_regions" :key="region">{{ region }}</span>
            </div>
          </div>

          <div class="source-actions">
            <label class="inline-switch">
              <span>{{ sub.enabled ? '启用' : '停用' }}</span>
              <button
                type="button"
                class="switch"
                :class="{ on: sub.enabled }"
                :disabled="Boolean(togglingIds[sub.id])"
                @click.prevent="$emit('toggle', sub)"
              >
                <i></i>
              </button>
            </label>
            <div class="actions">
              <button class="ghost" :disabled="Boolean(testingIds[sub.id])" @click="$emit('test', sub)">
                {{ testingIds[sub.id] ? '测试中...' : '测试' }}
              </button>
              <button v-if="reports[sub.id]" class="ghost" @click="$emit('toggle-report', sub)">
                {{ reports[sub.id].expanded ? '收起' : '结果' }}
              </button>
              <button class="ghost" @click="$emit('edit', sub)">编辑</button>
              <button class="danger" :disabled="deletingId === sub.id" @click="$emit('delete', sub)">
                {{ deletingId === sub.id ? '删除中...' : '删除' }}
              </button>
            </div>
          </div>

          <SubscriptionTestReport
            v-if="reports[sub.id]?.expanded"
            :report="reports[sub.id]"
            :regions="regions.map((region) => region.id)"
            :tested-at="reports[sub.id].tested_at"
          />
        </article>
      </div>
    </div>

    <div v-if="modalOpen" class="modal-backdrop" @click.self="$emit('close-modal')">
      <form class="modal subscription-modal" @submit.prevent="$emit('save')">
        <div class="panel-head">
          <h3>{{ form.id ? '编辑订阅源' : '添加订阅源' }}</h3>
          <button type="button" class="ghost" @click="$emit('close-modal')">关闭</button>
        </div>

        <label>
          <span>名称</span>
          <input v-model.trim="form.name" maxlength="80" placeholder="订阅源别名" />
        </label>
        <label>
          <span>订阅 URL</span>
          <input v-model.trim="form.url" type="url" autocomplete="url" placeholder="https://example.com/sub.json" />
        </label>
        <label class="check-row">
          <input v-model="form.enabled" type="checkbox" />
          <span>启用该订阅源</span>
        </label>

        <fieldset>
          <legend>允许区域</legend>
          <label v-for="region in regions" :key="region.id" class="check-row">
            <input v-model="form.allowed_regions" type="checkbox" :value="region.id" />
            <span>{{ region.emoji }} {{ region.id }} · {{ region.name }}</span>
          </label>
        </fieldset>

        <SubscriptionTestReport v-if="draftReport" :report="draftReport" :regions="regions.map((region) => region.id)" />

        <div class="modal-actions">
          <button type="button" class="ghost" :disabled="testingDraft || saving" @click="$emit('test-draft')">
            {{ testingDraft ? '测试中...' : '测试订阅源' }}
          </button>
          <button class="primary" :disabled="saving">
            {{ saving ? '保存中...' : '保存' }}
          </button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { RegionDefinition, SubscriptionPayload, SubscriptionRecord, SubscriptionTestReport as SubscriptionTestReportData } from '@shared/types';
import SubscriptionTestReport from './SubscriptionTestReport.vue';

type SavedReport = SubscriptionTestReportData & { tested_at: string; expanded: boolean };
type SubscriptionForm = SubscriptionPayload & { id?: string };

defineProps<{
  subscriptions: SubscriptionRecord[];
  regions: RegionDefinition[];
  loading: boolean;
  saving: boolean;
  testingDraft: boolean;
  modalOpen: boolean;
  form: SubscriptionForm;
  draftReport: SubscriptionTestReportData | null;
  reports: Record<string, SavedReport>;
  testingIds: Record<string, boolean>;
  togglingIds: Record<string, boolean>;
  deletingId: string;
}>();

defineEmits<{
  create: [];
  edit: [subscription: SubscriptionRecord];
  delete: [subscription: SubscriptionRecord];
  toggle: [subscription: SubscriptionRecord];
  test: [subscription: SubscriptionRecord];
  'toggle-report': [subscription: SubscriptionRecord];
  'test-draft': [];
  save: [];
  'close-modal': [];
}>();

function maskUrl(value: string) {
  try {
    const url = new URL(value);
    const path = url.pathname.length > 18 ? `${url.pathname.slice(0, 18)}...` : url.pathname;
    return `${url.origin}${path}`;
  } catch {
    return value;
  }
}
</script>
