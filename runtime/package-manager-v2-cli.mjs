import { loadRegistryFile } from './resolver.mjs';
import { parsePackageRequest } from './package-model.mjs';
import { explainResolution } from './solver-v2.mjs';
import { addRegistry, inspectRegistries, readRegistries, removeRegistry, resolveAcrossRegistries } from './registry-manager.mjs';
import { packageSecurityDecision } from './advisory.mjs';
import { printCliValue } from './cli-output.mjs';

function option(args, name, fallback) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; }
function has(args, name) { return args.includes(name); }

export function isPackageManagerV2Command(args = []) {
  return args[0] === 'registry' || (args[0] === 'package' && ['graph', 'explain', 'advisories', 'resolve-registry'].includes(args[1]));
}

export async function runPackageManagerV2Cli(args = process.argv.slice(2)) {
  let result;
  if (args[0] === 'registry') {
    const action = args[1] || 'list';
    const file = option(args, '--file');
    if (action === 'list') result = await readRegistries(file);
    else if (action === 'add') result = await addRegistry(args[2], args[3], { file, priority: option(args, '--priority', 0), trusted: has(args, '--trusted') });
    else if (action === 'remove') result = await removeRegistry(args[2], { file });
    else if (action === 'refresh' || action === 'doctor') result = await inspectRegistries({ file, allowStale: action !== 'doctor' });
    else throw new Error(`unknown registry action: ${action}`);
  } else {
    const action = args[1];
    const raw = args[2];
    if (!raw) throw new Error(`package ${action} requires package spec`);
    const request = parsePackageRequest(raw, { defaultType: option(args, '--type', 'plugin'), defaultVersion: '*', channel: option(args, '--channel', 'stable') });
    if (action === 'resolve-registry') result = await resolveAcrossRegistries(request.id, { type: request.type, version: request.versionRange, channel: request.channel, registry: option(args, '--registry'), file: option(args, '--registries-file') });
    else {
      const registry = await loadRegistryFile(option(args, '--registry', 'catalog/registry-v3.json'));
      const explained = explainResolution(registry, { type: request.type, id: request.id, version: request.versionRange, channel: request.channel });
      if (action === 'graph') result = { request: explained.request, selected: explained.selected, graph: explained.graph, dependency_order: explained.dependency_order };
      else if (action === 'explain') result = explained;
      else if (action === 'advisories') {
        const pkg = registry.plugins.find((item) => item.id === explained.selected.id && item.version === explained.selected.version);
        result = { package: explained.selected, security: packageSecurityDecision(pkg) };
      } else throw new Error(`unknown package v2 action: ${action}`);
    }
  }
  printCliValue(result, { argv: args });
  return result;
}
