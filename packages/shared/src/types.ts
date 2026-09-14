export type TemplateListItem = {
  id: string;
  name: string;
  updated_at?: string;
};

export type TemplateRecord = TemplateListItem & {
  raw_config: string;
  created_at?: string;
};

export type TemplateVersionRecord = {
  id: string;
  template_id: string;
  template_name: string;
  raw_config: string;
  version_note?: string | null;
  created_at?: string;
};

export type RegionCode = 'HK' | 'TW' | 'SG' | 'JP' | 'US';

export type SubscriptionRecord = {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  allowed_regions: RegionCode[];
  created_at?: string;
  updated_at?: string;
};

export type SubscriptionPayload = {
  name: string;
  url: string;
  enabled?: boolean;
  allowed_regions: RegionCode[];
};

export type SubscriptionTestReport = {
  success: boolean;
  status: 'success' | 'warning' | 'error';
  id?: string;
  name: string;
  duration_ms: number;
  raw_nodes: number;
  valid_nodes: number;
  regions?: Record<string, number>;
  warnings?: string[];
  error?: string;
};

export type ClientProfileSubscriptionBinding = {
  subscription_id: string;
  subscription_name: string;
  enabled: boolean;
  position: number;
  override_json?: string | null;
};

export type ClientProfileRecord = {
  id: string;
  name: string;
  template_id: string;
  template_name?: string;
  enabled: boolean;
  public_token: string;
  subscriptions: ClientProfileSubscriptionBinding[];
  created_at?: string;
  updated_at?: string;
};

export type ClientProfilePayload = {
  name: string;
  template_id: string;
  enabled?: boolean;
  subscriptions: Array<{
    subscription_id: string;
    position: number;
    override_json?: string | null;
  }>;
};
export type GenerationStep = {
  name: string;
  status: 'success' | 'warning' | 'error';
  message: string;
  details?: Record<string, unknown>;
};

export type GenerationTestResult = {
  success: boolean;
  output?: Record<string, unknown>;
  summary: Record<string, unknown>;
  steps: GenerationStep[];
  error?: string;
  used_cache?: boolean;
  cache_updated_at?: string;
};


export type GenerationSettings = {
  region_keywords: Record<RegionCode, string[]>;
  banned_pattern: string;
  subscription_user_agent: string;
  fetch_timeout_ms: number;
  max_subscription_bytes: number;
  urltest: {
    url: string;
    interval: string;
    tolerance: number;
  };
  dns_urltest: {
    enabled: boolean;
    keywords: string[];
    url: string;
    interval: string;
    tolerance: number;
  };
  manual_selector: {
    enabled: boolean;
    keywords: string[];
  };
};

export type GenerationSettingsPayload = GenerationSettings;

export type GenerationRunRecord = {
  id: string;
  client_profile_id: string;
  status: 'success' | 'error' | 'fallback';
  trigger_type: 'manual' | 'public';
  duration_ms: number;
  summary: Record<string, unknown>;
  steps: GenerationStep[];
  error?: string | null;
  used_cache: boolean;
  created_at?: string;
};

export type AuthLoginResponse = {
  token: string;
  expiresAt: number;
};

export type ApiError = {
  error: {
    code: string;
    message: string;
  };
};
