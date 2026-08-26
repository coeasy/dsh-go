export const RUNTIME_PACKAGE_TYPES = Object.freeze(['plugin', 'mcp', 'skill', 'agent']);

const PACKAGE_TYPES = new Set(RUNTIME_PACKAGE_TYPES);
const SPEC_ID_RE = /^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?$/;
const RUNTIME_ID_RE = /^[A-Za-z0-9_.-]+$/;
const VERSION_RE = /^[A-Za-z0-9*.^~+_-]+$/;

export function assertPackageType(value, fallback = 'plugin') {
  const type = String(value || fallback).trim().toLowerCase();
  if (!PACKAGE_TYPES.has(type)) throw new Error(`unsupported runtime package type: ${type || '<empty>'}`);
  return type;
}

export function safePackageId(value, options = {}) {
  const id = String(value || '').trim();
  const pattern = options.allowRepository ? SPEC_ID_RE : RUNTIME_ID_RE;
  if (!id || id.length > 200 || !pattern.test(id)) {
    throw new Error(`unsafe runtime package id: ${id || '<empty>'}`);
  }
  return id;
}

export function packageKey(type, id) {
  return `${assertPackageType(type)}:${safePackageId(id).toLowerCase()}`;
}

export function inferPackageType(item) {
  const explicitType = String(item?.type || '').toLowerCase();
  if (PACKAGE_TYPES.has(explicitType)) return explicitType;
  const runtimeType = String(item?.runtime?.type || '').toLowerCase();
  if (PACKAGE_TYPES.has(runtimeType)) return runtimeType;
  const capabilities = Array.isArray(item?.capabilities) ? item.capabilities.map((value) => String(value).toLowerCase()) : [];
  for (const type of ['mcp', 'skill', 'agent']) {
    if (capabilities.includes(type)) return type;
  }
  return 'plugin';
}

export function parsePackageSpec(spec, defaultVersion = '0.1.0', defaultType = 'plugin') {
  let raw = String(spec || '').trim();
  if (!raw) throw new Error('runtime package spec is required');
  if (raw.length > 512) throw new Error('runtime package spec is too long');

  let type = assertPackageType(defaultType);
  const colon = raw.indexOf(':');
  if (colon > 0) {
    const prefix = raw.slice(0, colon).toLowerCase();
    if (PACKAGE_TYPES.has(prefix)) {
      type = prefix;
      raw = raw.slice(colon + 1);
    }
  }
  if (raw.startsWith('github:')) raw = raw.slice('github:'.length);

  const at = raw.lastIndexOf('@');
  const id = at > 0 ? raw.slice(0, at) : raw;
  const version = at > 0 ? raw.slice(at + 1) || defaultVersion : defaultVersion;
  safePackageId(id, { allowRepository: true });
  if (!version || version.length > 128 || !VERSION_RE.test(version)) {
    throw new Error(`invalid runtime package version: ${version || '<empty>'}`);
  }
  return { type, id, version };
}

export function normalizePackageDependency(dependency, defaultType = 'plugin') {
  if (typeof dependency === 'string') {
    const parsed = parsePackageSpec(dependency, '*', defaultType);
    return { type: parsed.type, id: parsed.id, range: parsed.version || '*', optional: false };
  }
  if (!dependency?.id) throw new Error('dependency id is required');
  return {
    type: assertPackageType(dependency.type || defaultType),
    id: safePackageId(dependency.id, { allowRepository: true }),
    range: dependency.range || dependency.version || '*',
    optional: dependency.optional === true,
  };
}

export function manifestCandidates(type) {
  const unified = { file: 'dsh-package.json', format: 'json' };
  switch (assertPackageType(type)) {
    case 'plugin':
      return [
        unified,
        { file: 'dsh-plugin.json', format: 'json' },
        { file: 'package.json', format: 'json' },
      ];
    case 'mcp':
      return [
        unified,
        { file: 'dsh-mcp.json', format: 'json' },
        { file: 'mcp.json', format: 'json' },
        { file: 'package.json', format: 'json' },
      ];
    case 'skill':
      return [
        unified,
        { file: 'SKILL.md', format: 'markdown' },
        { file: 'skill.md', format: 'markdown' },
        { file: 'dsh-skill.json', format: 'json' },
        { file: 'package.json', format: 'json' },
      ];
    case 'agent':
      return [
        unified,
        { file: 'dsh-agent.json', format: 'json' },
        { file: 'agent.json', format: 'json' },
        { file: 'package.json', format: 'json' },
      ];
    default:
      return [];
  }
}
