CREATE TABLE IF NOT EXISTS templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  raw_config TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS template_versions (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL,
  template_name TEXT NOT NULL,
  raw_config TEXT NOT NULL,
  version_note TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_template_versions_template_id_created_at
  ON template_versions(template_id, created_at DESC);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url_encrypted TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  allowed_regions_json TEXT NOT NULL DEFAULT '[]',
  dns_json TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_created_at
  ON subscriptions(created_at DESC);
CREATE TABLE IF NOT EXISTS client_profiles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  template_id TEXT NOT NULL,
  public_token TEXT NOT NULL UNIQUE,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (template_id) REFERENCES templates(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_client_profiles_template_id
  ON client_profiles(template_id);

CREATE TABLE IF NOT EXISTS client_profile_subscriptions (
  client_profile_id TEXT NOT NULL,
  subscription_id TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  override_json TEXT,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_profile_id, subscription_id),
  FOREIGN KEY (client_profile_id) REFERENCES client_profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (subscription_id) REFERENCES subscriptions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_client_profile_subscriptions_profile_position
  ON client_profile_subscriptions(client_profile_id, position);

CREATE TABLE IF NOT EXISTS generation_runs (
  id TEXT PRIMARY KEY,
  client_profile_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('success', 'error', 'fallback')),
  trigger_type TEXT NOT NULL DEFAULT 'manual' CHECK (trigger_type IN ('manual', 'public')),
  duration_ms INTEGER NOT NULL DEFAULT 0,
  summary_json TEXT NOT NULL DEFAULT '{}',
  steps_json TEXT NOT NULL DEFAULT '[]',
  error TEXT,
  used_cache INTEGER NOT NULL DEFAULT 0 CHECK (used_cache IN (0, 1)),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_profile_id) REFERENCES client_profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_generation_runs_profile_created_at
  ON generation_runs(client_profile_id, created_at DESC);

CREATE TABLE IF NOT EXISTS client_profile_config_cache (
  client_profile_id TEXT PRIMARY KEY,
  config_json TEXT NOT NULL,
  summary_json TEXT NOT NULL DEFAULT '{}',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (client_profile_id) REFERENCES client_profiles(id) ON DELETE CASCADE
);


CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
