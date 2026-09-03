import { readRegistries } from './registry-manager.mjs';

function optionIndex(args, name) {
  return args.indexOf(name);
}

function shouldPreserveRegistryName(args) {
  if (args[0] === 'registry') return true;
  return args[0] === 'package' && args[1] === 'resolve-registry';
}

function looksLikeSource(value) {
  const input = String(value || '').trim();
  return /^https?:\/\//i.test(input)
    || input.startsWith('.')
    || input.startsWith('/')
    || input.includes('\\')
    || input.includes('/')
    || input.toLowerCase().endsWith('.json');
}

export async function resolveNamedRegistryArgs(args = []) {
  const values = [...args];
  if (shouldPreserveRegistryName(values)) return { args: values, registry: null };
  const index = optionIndex(values, '--registry');
  if (index < 0 || !values[index + 1] || looksLikeSource(values[index + 1])) return { args: values, registry: null };
  const requested = values[index + 1];
  const config = await readRegistries();
  const registry = config.registries.find((item) => item.name.toLowerCase() === String(requested).toLowerCase());
  if (!registry) return { args: values, registry: null };
  values[index + 1] = registry.url;
  process.env.DSH_SELECTED_REGISTRY_NAME = registry.name;
  process.env.DSH_SELECTED_REGISTRY_URL = registry.url;
  process.env.DSH_SELECTED_REGISTRY_TRUSTED = registry.trusted ? '1' : '0';
  if (registry.organization) process.env.DSH_SELECTED_REGISTRY_ORGANIZATION = registry.organization;
  else delete process.env.DSH_SELECTED_REGISTRY_ORGANIZATION;
  if (registry.auth_env) process.env.DSH_REGISTRY_AUTH_ENV = registry.auth_env;
  else delete process.env.DSH_REGISTRY_AUTH_ENV;
  return { args: values, registry };
}
