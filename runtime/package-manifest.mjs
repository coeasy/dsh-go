import { access, readFile, writeFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { DSH_DEFAULT_PACKAGE_VERSION, DSH_PACKAGE_MANIFEST_VERSION } from './version.mjs';
import { KNOWN_PERMISSIONS, inspectPermissions } from './permissions.mjs';
import { compilePermissionManifest } from './permission-manifest.mjs';

export const DSH_MANIFEST_FILES = Object.freeze([
  'dsh-package.json',
  'dsh-plugin.json',
  'dsh-mcp.json',
  'dsh-skill.json',
  'dsh-agent.json',
]);
export const DSH_PACKAGE_TYPES = Object.freeze(['plugin', 'mcp', 'skill', 'agent']);

const TYPE_BY_FILE = Object.freeze({
  'dsh-plugin.json': 'plugin',
  'dsh-mcp.json': 'mcp',
  'dsh-skill.json': 'skill',
  'dsh-agent.json': 'agent',
});
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const ID_RE = /^[A-Za-z0-9_.-]+$/;

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

export function manifestType(data, file = '') {
  const explicit = String(data?.type || data?.runtime?.type || '').toLowerCase();
  if (DSH_PACKAGE_TYPES.includes(explicit)) return explicit;
  if (basename(file) === 'dsh-package.json') return '';
  return TYPE_BY_FILE[basename(file)] || 'plugin';
}

function stringArray(value, max = 100) {
  return [...new Set((Array.isArray(value) ? value : []).filter((item) => typeof item === 'string').map((item) => item.trim()).filter(Boolean))].slice(0, max);
}

function objectOrUndefined(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : undefined;
}

export function normalizePackageManifest(data, file = 'dsh-package.json') {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const type = manifestType(data, file);
  const permissionModel = compilePermissionManifest(data.permissions, data.permission_policy);
  const manifest = {
    manifest_version: typeof data.manifest_version === 'string' ? data.manifest_version.trim() : undefined,
    id: typeof data.id === 'string' ? data.id.trim() : undefined,
    name: typeof data.name === 'string' ? data.name.trim().slice(0, 200) : undefined,
    version: typeof data.version === 'string' ? data.version.trim() : DSH_DEFAULT_PACKAGE_VERSION,
    type,
    description: typeof data.description === 'string' ? data.description.trim().slice(0, 4000) : undefined,
    category: typeof data.category === 'string' ? data.category.trim() : undefined,
    tags: stringArray(data.tags),
    capabilities: stringArray(data.capabilities),
    dependencies: Array.isArray(data.dependencies) ? data.dependencies.slice(0, 200) : [],
    permissions: permissionModel.permissions,
    permission_policy: Object.keys(permissionModel.permission_policy).length ? permissionModel.permission_policy : objectOrUndefined(data.permission_policy),
    permission_manifest: permissionModel.structured ? permissionModel.permission_manifest : undefined,
    compatibility: objectOrUndefined(data.compatibility),
    publisher: objectOrUndefined(data.publisher),
    security: objectOrUndefined(data.security),
    conflicts: stringArray(data.conflicts),
    replaces: stringArray(data.replaces),
    provides: stringArray(data.provides),
    plugin: type === 'plugin' ? objectOrUndefined(data.plugin) : undefined,
    mcp: type === 'mcp' ? objectOrUndefined(data.mcp) : undefined,
    skill: type === 'skill' ? objectOrUndefined(data.skill) : undefined,
    agent: type === 'agent' ? objectOrUndefined(data.agent) : undefined,
  };
  return Object.fromEntries(Object.entries(manifest).filter(([, value]) => value !== undefined));
}

function validatePermissionPolicy(policy, errors) {
  if (!policy) return;
  for (const [name, rule] of Object.entries(policy)) {
    if (!KNOWN_PERMISSIONS.includes(name)) errors.push(`permission_policy contains unknown permission: ${name}`);
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) errors.push(`permission_policy.${name} must be an object`);
  }
}

export function validatePackageManifest(data, options = {}) {
  const file = options.file || 'dsh-package.json';
  const manifest = normalizePackageManifest(data, file);
  const errors = [];
  const warnings = [];
  if (!manifest) return { valid: false, errors: ['manifest must be a JSON object'], warnings, manifest: null };
  if (file === 'dsh-package.json' && manifest.manifest_version !== DSH_PACKAGE_MANIFEST_VERSION) errors.push(`manifest_version must be ${DSH_PACKAGE_MANIFEST_VERSION}`);
  if (manifest.id && !ID_RE.test(manifest.id)) errors.push('id must contain only letters, numbers, dot, underscore, and dash');
  if (!manifest.name) errors.push('name is required');
  if (!VERSION_RE.test(manifest.version)) errors.push('version must be semantic version');
  if (!DSH_PACKAGE_TYPES.includes(manifest.type)) errors.push('type must be plugin, mcp, skill, or agent');
  if (manifest.version !== DSH_DEFAULT_PACKAGE_VERSION && options.enforceDefaultVersion) errors.push(`new ecosystem packages must start at ${DSH_DEFAULT_PACKAGE_VERSION}`);
  const permissionReport = inspectPermissions(manifest.permissions);
  if (permissionReport.unknown.length) errors.push(`unknown permissions: ${permissionReport.unknown.join(', ')}`);
  validatePermissionPolicy(data.permission_policy, errors);
  validatePermissionPolicy(manifest.permission_policy, errors);
  if (manifest.type === 'mcp') {
    const transport = manifest.mcp?.transport;
    if (!['stdio', 'sse', 'streamable-http'].includes(transport)) errors.push('mcp.transport must be stdio, sse, or streamable-http');
    if (transport === 'stdio' && !manifest.mcp?.command) errors.push('mcp.command is required for stdio transport');
    if (transport !== 'stdio' && !manifest.mcp?.url) errors.push('mcp.url is required for remote transport');
  }
  if (manifest.type === 'skill') {
    if (!manifest.skill?.executor) errors.push('skill.executor is required');
    if (!manifest.skill?.entrypoint) errors.push('skill.entrypoint is required');
  }
  if (manifest.type === 'agent' && !manifest.agent?.workflow && !manifest.agent?.entrypoint) errors.push('agent.workflow or agent.entrypoint is required');
  if (manifest.publisher?.provider && manifest.publisher.provider !== 'github') warnings.push('publisher ownership auto-verification currently supports GitHub publishers only');
  if (manifest.security?.signature && !manifest.security?.provenance) warnings.push('signature is declared without provenance metadata');
  if (permissionReport.dangerous.length) warnings.push(`high-risk permissions require install consent: ${permissionReport.dangerous.join(', ')}`);
  return { valid: errors.length === 0, errors, warnings, manifest, permissionReport };
}

export async function findPackageManifest(root = process.cwd()) {
  for (const file of DSH_MANIFEST_FILES) {
    const path = join(resolve(root), file);
    if (!(await exists(path))) continue;
    const data = JSON.parse(await readFile(path, 'utf8'));
    return { file, path, data, ...validatePackageManifest(data, { file }) };
  }
  return null;
}

export function createManifestTemplate(type = 'plugin', options = {}) {
  const normalizedType = DSH_PACKAGE_TYPES.includes(type) ? type : 'plugin';
  const template = {
    manifest_version: DSH_PACKAGE_MANIFEST_VERSION,
    id: options.id || 'my-dsh-package',
    name: options.name || 'My DSH Package',
    version: DSH_DEFAULT_PACKAGE_VERSION,
    type: normalizedType,
    description: '',
    tags: [],
    capabilities: [normalizedType],
    dependencies: [],
    permissions: [],
    permission_policy: {},
    compatibility: { os: ['linux', 'darwin', 'win32'], arch: ['x64', 'arm64'], node: '>=20.0.0', runtime: '>=0.1.0' },
    publisher: { provider: 'github', id: '', repository_ownership: 'required' },
    security: { provenance: null, signature: null, sbom: null, license: '' },
  };
  if (normalizedType === 'plugin') template.plugin = { entrypoint: '' };
  if (normalizedType === 'mcp') template.mcp = { transport: 'stdio', command: '', args: [], tools: [] };
  if (normalizedType === 'skill') template.skill = { executor: 'node', entrypoint: 'index.mjs', input_schema: null, output_schema: null };
  if (normalizedType === 'agent') template.agent = { entrypoint: '', workflow: null, model: { required: false }, tools: [] };
  return template;
}

export async function writeManifestTemplate(file = 'dsh-package.json', type = 'plugin', options = {}) {
  const target = resolve(file);
  if (await exists(target)) throw new Error(`manifest already exists: ${target}`);
  const template = createManifestTemplate(type, options);
  await writeFile(target, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
  return { file: target, manifest: template };
}

export function supportedPermissions() {
  return [...KNOWN_PERMISSIONS];
}
