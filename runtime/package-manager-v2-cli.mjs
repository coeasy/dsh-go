import { loadRegistryFile } from './resolver.mjs';
import { parsePackageRequest } from './package-model.mjs';
import { explainResolution } from './solver-v2.mjs';
import { addRegistry, inspectRegistries, readRegistries, removeRegistry, resolveAcrossRegistries } from './registry-manager.mjs';
import { inspectPackageAdvisories } from './advisory.mjs';
import { exportDshPackage, installDshPackage } from './dshpkg.mjs';
import { buildPublisherSubmission, inspectPublisherPackage } from './publisher-workflow.mjs';
import { printCliValue } from './cli-output.mjs';

function option(args, name, fallback) { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; }
function has(args, name) { return args.includes(name); }

export function isPackageManagerV2Command(args = []) {
  if (args[0] === 'registry') return true;
  if (args[0] !== 'package') return false;
  if (['graph', 'explain', 'advisories', 'resolve-registry', 'export', 'publisher-check', 'submission-plan', 'manifest-v2'].includes(args[1])) return true;
  return ['install', 'add'].includes(args[1]) && String(args[2] || '').toLowerCase().endsWith('.dshpkg');
}

export async function runPackageManagerV2Cli(args = process.argv.slice(2)) {
  let result;
  if (args[0] === 'registry') {
    const action = args[1] || 'list';
    const file = option(args, '--file');
    if (action === 'list') result = await readRegistries(file);
    else if (action === 'add') result = await addRegistry(args[2], args[3], {
      file,
      priority: option(args, '--priority', 0),
      trusted: has(args, '--trusted'),
      organization: option(args, '--organization'),
      scope: option(args, '--scope'),
      authEnv: option(args, '--auth-env'),
    });
    else if (action === 'remove') result = await removeRegistry(args[2], { file });
    else if (action === 'refresh' || action === 'doctor') result = await inspectRegistries({ file, allowStale: action !== 'doctor' });
    else throw new Error(`unknown registry action: ${action}`);
  } else {
    const action = args[1];
    const raw = args[2];
    if (['publisher-check', 'submission-plan', 'manifest-v2'].includes(action)) {
      const root = raw || process.cwd();
      const inspection = await inspectPublisherPackage(root);
      if (action === 'manifest-v2') result = inspection.manifest_v2;
      else if (action === 'publisher-check') result = inspection;
      else result = await buildPublisherSubmission(root, { outputDir: option(args, '--output-dir') });
    } else {
      if (!raw) throw new Error(`package ${action} requires package spec`);
      if (action === 'export') {
        result = await exportDshPackage(raw, option(args, '--output'), { registryFile: option(args, '--runtime-registry'), type: option(args, '--type') });
      } else if (['install', 'add'].includes(action) && raw.toLowerCase().endsWith('.dshpkg')) {
        result = await installDshPackage(raw, {
          registryFile: option(args, '--runtime-registry'),
          root: option(args, '--root'),
          enterprisePolicyFile: option(args, '--policy-file'),
          dryRun: has(args, '--dry-run'),
          approved: has(args, '--yes'),
        });
      } else {
        const request = parsePackageRequest(raw, { defaultType: option(args, '--type', 'plugin'), defaultVersion: '*', channel: option(args, '--channel', 'stable') });
        if (action === 'resolve-registry') result = await resolveAcrossRegistries(request.id, { type: request.type, version: request.versionRange, channel: request.channel, registry: option(args, '--registry'), file: option(args, '--registries-file') });
        else {
          const registry = await loadRegistryFile(option(args, '--registry', 'catalog/registry-v3.json'));
          if (action === 'advisories') result = inspectPackageAdvisories(registry, { type: request.type, id: request.id, versionRange: request.versionRange, channel: request.channel });
          else {
            const explained = explainResolution(registry, { type: request.type, id: request.id, version: request.versionRange, channel: request.channel });
            if (action === 'graph') result = { request: explained.request, selected: explained.selected, graph: explained.graph, dependency_order: explained.dependency_order };
            else if (action === 'explain') result = explained;
            else throw new Error(`unknown package v2 action: ${action}`);
          }
        }
      }
    }
  }
  printCliValue(result, { argv: args });
  return result;
}
