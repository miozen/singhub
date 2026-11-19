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

        <fieldset>
          <legend>专用 DNS</legend>
          <div class="dns-head" style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem;">
            <label class="check-row">
              <input :checked="!!form.dns?.enabled" type="checkbox" @change="toggleDnsEnabled" />
              <span>启用该订阅源的专用 DNS</span>
            </label>
            <button
              v-if="form.dns?.enabled"
              type="button"
              class="ghost"
              @click="switchDnsMode"
            >{{ dnsMode === 'form' ? '高级 JSON 模式' : '切换到表单模式' }}</button>
          </div>
          <template v-if="form.dns?.enabled">
            <div v-if="dnsMode === 'form'" class="dns-form-fields">
              <label>
                <span>DNS 标签 Tag (可选)</span>
                <input v-model.trim="form.dns.tag" placeholder="留空自动生成 dns-src-{id}" />
              </label>
              <label>
                <span>协议类型</span>
                <select v-model="form.dns.type">
                  <option value="https">DoH (HTTPS)</option>
                  <option value="tls">DoT (TLS)</option>
                  <option value="udp">UDP</option>
                  <option value="tcp">TCP</option>
                  <option value="quic">DoQ (QUIC)</option>
                  <option value="h3">HTTP/3</option>
                </select>
              </label>
              <label>
                <span>DNS 服务器地址</span>
                <input v-model.trim="form.dns.server" placeholder="1.1.1.1" />
              </label>
              <label>
                <span>端口 (可选)</span>
                <input v-model.number="form.dns.server_port" type="number" placeholder="443" />
              </label>
              <label>
                <span>请求路径 (DoH/h3 可选)</span>
                <input v-model.trim="form.dns.path" placeholder="/dns-query" />
              </label>
              <label>
                <span>出站标签 Detour (可选)</span>
                <input v-model.trim="form.dns.detour" placeholder="留空为直连" />
              </label>
              <label>
                <span>前置解析器 Domain Resolver (可选)</span>
                <input v-model.trim="form.dns.domain_resolver" placeholder="解析此 DNS 自身域名的前置 DNS tag" />
              </label>
              <label>
                <span>解析策略 (可选)</span>
                <select v-model="form.dns.strategy">
                  <option value="">默认</option>
                  <option value="prefer_ipv4">prefer_ipv4</option>
                  <option value="prefer_ipv6">prefer_ipv6</option>
                  <option value="ipv4_only">ipv4_only</option>
                  <option value="ipv6_only">ipv6_only</option>
                </select>
              </label>
            </div>
            <div v-else class="dns-json-fields">
              <label>
                <span>高级 JSON 配置</span>
                <textarea
                  v-model="dnsJsonText"
                  rows="11"
                  spellcheck="false"
                  style="width: 100%; box-sizing: border-box; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 12px; resize: vertical;"
                  placeholder='{\n  "type": "https",\n  "server": "doh.example.com"\n}'
                ></textarea>
              </label>
              <p v-if="dnsJsonError" class="dns-json-error" style="color: #c0392b; font-size: 12px; margin-top: 0.4rem;">{{ dnsJsonError }}</p>
              <p class="dns-json-hint" style="color: #6b7280; font-size: 12px; margin-top: 0.4rem; line-height: 1.5;">可直接填写 sing-box DNS server 支持的任意字段（如 client_subnet）。切回表单不会影响表单字段的显示，额外字段也会保留。</p>
            </div>
          </template>
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
import { ref, watch } from 'vue';
import type { RegionDefinition, SourceDnsConfig, SubscriptionPayload, SubscriptionRecord, SubscriptionTestReport as SubscriptionTestReportData } from '@shared/types';
import SubscriptionTestReport from './SubscriptionTestReport.vue';

type SavedReport = SubscriptionTestReportData & { tested_at: string; expanded: boolean };
type SubscriptionForm = SubscriptionPayload & { id?: string };

const props = defineProps<{
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

type DnsMode = 'form' | 'json';
const dnsMode = ref<DnsMode>('form');
const dnsJsonText = ref('');
const dnsJsonError = ref('');

function defaultDns(): SourceDnsConfig {
  return {
    enabled: true,
    tag: null,
    type: 'https',
    server: '',
    server_port: null,
    path: null,
    detour: null,
    domain_resolver: null,
    strategy: null,
    client_subnet: null
  };
}

function toggleDnsEnabled() {
  if (props.form.dns?.enabled) {
    props.form.dns = null;
    dnsMode.value = 'form';
  } else {
    props.form.dns = defaultDns();
    dnsMode.value = 'form';
  }
  dnsJsonError.value = '';
}

// 进入 JSON 模式时，把当前完整 dns 对象序列化（去掉 enabled，由开关单独控制）
function switchDnsMode() {
  if (dnsMode.value === 'form') {
    dnsJsonError.value = '';
    const { enabled: _enabled, ...rest } = props.form.dns || defaultDns();
    dnsJsonText.value = JSON.stringify(rest, null, 2);
    dnsMode.value = 'json';
  } else {
    dnsMode.value = 'form';
  }
}

// 每次打开弹窗时回到表单模式，避免上一次编辑残留的 JSON 状态
watch(() => props.modalOpen, (open) => {
  if (open) {
    dnsMode.value = 'form';
    dnsJsonError.value = '';
  }
});

// JSON 编辑时同步回 form.dns：先解析，再合并到默认结构。
// 合并（而非替换）保证：JSON 里缺失的表单字段有默认值，JSON 里额外的字段被原样保留。
watch(dnsJsonText, (text) => {
  if (dnsMode.value !== 'json') return;
  try {
    const parsed = text.trim() ? JSON.parse(text) : {};
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('必须是 JSON 对象');
    dnsJsonError.value = '';
    props.form.dns = { ...defaultDns(), ...parsed, enabled: true } as SourceDnsConfig;
  } catch (err) {
    dnsJsonError.value = `JSON 格式有误：${err instanceof Error ? err.message : '解析失败'}`;
  }
});

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
