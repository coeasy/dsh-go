export const MARKETPLACE_LOCALES = Object.freeze(['en', 'zh-CN', 'ja', 'ko', 'es']);

export function normalizeMarketplaceLocale(value, fallback = 'en') {
  const raw = String(value || '').trim().replace('_', '-');
  if (!raw) return fallback;
  const exact = MARKETPLACE_LOCALES.find((locale) => locale.toLowerCase() === raw.toLowerCase());
  if (exact) return exact;
  const language = raw.split('-')[0].toLowerCase();
  const family = MARKETPLACE_LOCALES.find((locale) => locale.split('-')[0].toLowerCase() === language);
  return family || fallback;
}

export function localizationKey(type, id) {
  return `${type}:${id}`;
}

export function applyLocalizationOverlay(pkg, overlay, locale) {
  const normalizedLocale = normalizeMarketplaceLocale(locale);
  const type = pkg?.type || pkg?.runtime?.type || 'plugin';
  const entry = overlay?.entries?.[localizationKey(type, pkg?.id)] || null;
  return {
    locale: normalizedLocale,
    source: entry ? 'overlay' : 'package',
    name: entry?.name || pkg?.metadata?.name || pkg?.name || pkg?.id || '',
    description: entry?.description || pkg?.metadata?.description || pkg?.description || '',
    summary: entry?.summary || null,
    category_label: entry?.category_label || pkg?.metadata?.category || null,
  };
}

export function validateLocalizationOverlay(value) {
  const errors = [];
  if (value?.schema_version !== 1) errors.push('schema_version must be 1');
  if (!value?.locale) errors.push('locale is required');
  if (!value?.entries || typeof value.entries !== 'object' || Array.isArray(value.entries)) errors.push('entries must be an object');
  for (const [key, entry] of Object.entries(value?.entries || {})) {
    if (!/^(plugin|mcp|skill|agent):[A-Za-z0-9_.-]+$/.test(key)) errors.push(`invalid localization key: ${key}`);
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) errors.push(`invalid localization entry: ${key}`);
  }
  return { valid: errors.length === 0, errors, locale: normalizeMarketplaceLocale(value?.locale), entries: value?.entries || {} };
}
