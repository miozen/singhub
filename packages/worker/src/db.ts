export type TemplateRow = {
  id: string;
  name: string;
  raw_config: string;
  created_at?: string;
  updated_at?: string;
};

export type TemplateVersionRow = {
  id: string;
  template_id: string;
  template_name: string;
  raw_config: string;
  version_note?: string | null;
  created_at?: string;
};


export type SubscriptionRow = {
  id: string;
  name: string;
  url_encrypted: string;
  enabled: number;
  allowed_regions_json: string;
  dns_json?: string | null;
  created_at?: string;
  updated_at?: string;
};


export type ClientProfileRow = {
  id: string;
  name: string;
  template_id: string;
  template_name?: string;
  public_token: string;
  enabled: number;
  created_at?: string;
  updated_at?: string;
};

export type ClientProfileSubscriptionRow = {
  client_profile_id: string;
  subscription_id: string;
  subscription_name: string;
  subscription_enabled: number;
  position: number;
  override_json?: string | null;
};
export function getTemplateList(db: D1Database) {
  return db.prepare('SELECT id, name, updated_at FROM templates ORDER BY updated_at DESC').all();
}

export function getTemplateById(db: D1Database, id: string) {
  return db.prepare('SELECT * FROM templates WHERE id = ?').bind(id).first<TemplateRow>();
}

export function getTemplateVersions(db: D1Database, templateId: string) {
  return db.prepare(`
    SELECT id, template_id, template_name, raw_config, version_note, created_at
    FROM template_versions
    WHERE template_id = ?
    ORDER BY created_at DESC, id DESC
  `).bind(templateId).all<TemplateVersionRow>();
}

export function getTemplateVersionById(db: D1Database, templateId: string, versionId: string) {
  return db.prepare(`
    SELECT id, template_id, template_name, raw_config, version_note, created_at
    FROM template_versions
    WHERE template_id = ? AND id = ?
  `).bind(templateId, versionId).first<TemplateVersionRow>();
}


export function getSubscriptionList(db: D1Database) {
  return db.prepare(`
    SELECT * FROM subscriptions
    ORDER BY created_at DESC, id DESC
  `).all<SubscriptionRow>();
}

export function getSubscriptionById(db: D1Database, id: string) {
  return db.prepare(`
    SELECT * FROM subscriptions
    WHERE id = ?
  `).bind(id).first<SubscriptionRow>();
}
export function getClientProfileList(db: D1Database) {
  return db.prepare(`
    SELECT p.id, p.name, p.template_id, t.name AS template_name, p.public_token, p.enabled, p.created_at, p.updated_at
    FROM client_profiles p
    LEFT JOIN templates t ON t.id = p.template_id
    ORDER BY p.created_at DESC, p.id DESC
  `).all<ClientProfileRow>();
}

export function getClientProfileById(db: D1Database, id: string) {
  return db.prepare(`
    SELECT p.id, p.name, p.template_id, t.name AS template_name, p.public_token, p.enabled, p.created_at, p.updated_at
    FROM client_profiles p
    LEFT JOIN templates t ON t.id = p.template_id
    WHERE p.id = ?
  `).bind(id).first<ClientProfileRow>();
}

export function getClientProfileByToken(db: D1Database, token: string) {
  return db.prepare(`
    SELECT p.id, p.name, p.template_id, t.name AS template_name, p.public_token, p.enabled, p.created_at, p.updated_at
    FROM client_profiles p
    LEFT JOIN templates t ON t.id = p.template_id
    WHERE p.public_token = ?
  `).bind(token).first<ClientProfileRow>();
}

export function getClientProfileSubscriptions(db: D1Database, profileId: string) {
  return db.prepare(`
    SELECT b.client_profile_id, b.subscription_id, s.name AS subscription_name, s.enabled AS subscription_enabled,
      b.position, b.override_json
    FROM client_profile_subscriptions b
    JOIN subscriptions s ON s.id = b.subscription_id
    WHERE b.client_profile_id = ?
    ORDER BY b.position ASC, s.created_at ASC
  `).bind(profileId).all<ClientProfileSubscriptionRow>();
}