#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { ensureRegistryCache, loadRegistrySource, resolveRegistrySource } from './catalog.mjs';
import { buildInstallDeepLink, deepLinkInstallPlan, parseDshUrl, registerProtocolHandler } from './client-bridge.mjs';
import { findPackageManifest, writeManifestTemplate } from './package-manifest.mjs';
import { preflightPackage } from './preflight.mjs';
import { parsePluginSpec } from './resolver.mjs';
import { readRuntimeRegistry } from './registry.mjs';
import { versionInfo } from './version.mjs';
import { startClientHost } from './client-host.mjs';
import { auditPackageSecurity } from '../scripts/package-security-audit.mjs';
import { generateSbom } from '../scripts/generate-sbom.mjs';

const LEGACY_CLI = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const ECOSYSTEM_TYPES = new Set(['plugin', 'mcp', 'skill', 'agent']);
const LOCAL_LIFECYCLE = new Set(['list', 'status', 'remove', 'rollback', 'health', 'doctor', 'enable', 'disable', 'history']);

function option(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function has(args, name) { return args.includes(name); }
function stripFlag(args, name) { return args.filter((value) => value !== name); }
function print(value) { console.log(JSON.stringify(value, null, 2)); }

function help() {
  console.log(`DSH CLI - local runtime and ecosystem manager

Usage:
  dsh version
  dsh plugin|mcp|skill|agent install <id[@version]> [--channel stable] [--yes] [--dry-run]
  dsh plugin|mcp|skill|agent list|status|update|remove|rollback|doctor|repair|enable|disable|history ...
  dsh ecosystem list|status
  dsh preflight <id[@version]> [--type plugin|mcp|skill|agent]
  dsh bridge link <id[@version]> [--type plugin|mcp|skill|agent]
  dsh bridge parse <dsh://...>
  dsh bridge register [--dry-run]
  dsh bridge handle <dsh://...> [--yes]
  dsh bridge serve [--port 43731]
  dsh package init [--type plugin|mcp|skill|agent] [--id ID] [--name NAME]
  dsh package validate [directory]
  dsh package audit [directory]
  dsh package sbom [directory] [output]
  dsh package publish-check [directory]
  dsh profile apply <profile.json> [--yes] [--dry-run]
  dsh bundle install <bundle.json> [--yes] [--dry-run]

Install/update never restarts the client automatically. Successful changes are activated by the startup loader after a manual restart.`);
}

async function registryContext(args) {
  const explicit = option(args, '--registry');
  const source = await resolveRegistrySource(explicit);
  const registry = await loadRegistrySource(source);
  const file = await ensureRegistryCache(source);
  return { registry, file, source };
}

function recordType(record) {
  return record?.type || record?.runtime?.type || 'plugin';
}

async function confirm(message) {
  if (!input.isTTY || !output.isTTY) return false;
  const rl = createInterface({ input, output });
  try {
    const answer = (await rl.question(`${message} [y/N] `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally { rl.close(); }
}

async function runLegacy(args, registryFile, approved = false) {
  const forwarded = [...args];
  if (registryFile && !forwarded.includes('--registry')) forwarded.push('--registry', registryFile);
  const env = { ...process.env };
  if (approved) env.DSH_PERMISSION_APPROVED = '1';
  else delete env.DSH_PERMISSION_APPROVED;
  const exitCode = await new Promise((accept, reject) => {
    const child = spawn(process.execPath, [LEGACY_CLI, ...forwarded], { stdio: 'inherit', windowsHide: false, env });
    child.on('error', reject);
    child.on('exit', (code, signal) => signal ? reject(new Error(`runtime terminated by ${signal}`)) : accept(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(`runtime command failed with exit code ${exitCode}`);
}

async function approvedPreflight(type, spec, args) {
  const ctx = await registryContext(args);
  const channel = option(args, '--channel');
  const runtimeRegistry = await readRuntimeRegistry();
  const preflight = preflightPackage(ctx.registry, spec, { type, channel, installed: runtimeRegistry.plugins });
  if (!preflight.allowed) throw new Error(`preflight blocked installation: ${preflight.reasons.join('; ')}`);
  if (has(args, '--dry-run')) return { ctx, preflight, approved: false };
  let approved = has(args, '--yes');
  const escalated = preflight.permission_diff.added.filter((permission) => preflight.permissions.dangerous.includes(permission) || preflight.permissions.unknown.includes(permission));
  if ((preflight.permissions.requires_consent || escalated.length) && !approved) {
    const packageCount = preflight.dependency_plan?.order?.length || 1;
    approved = await confirm(`${packageCount} package(s) request ${preflight.permissions.permissions.join(', ') || 'no special permissions'}. Continue?`);
    if (!approved) {
      const error = new Error('installation cancelled: explicit permission consent is required');
      error.code = 'DSH_PERMISSION_CONSENT_REQUIRED';
      throw error;
    }
  }
  return { ctx, preflight, approved };
}

async function installOrUpdate(type, action, spec, args) {
  if (!spec) throw new Error(`${action} requires a package id`);
  const { ctx, preflight, approved } = await approvedPreflight(type, spec, args);
  if (has(args, '--dry-run')) {
    print({ ...preflight, deep_link: buildInstallDeepLink({ id: preflight.id, version: preflight.version, channel: preflight.channel, type: preflight.type }) });
    return;
  }
  const forwardedFlags = stripFlag(args.slice(3), '--yes');
  let legacyArgs;
  if (action === 'update') {
    const parsed = parsePluginSpec(spec, '*');
    legacyArgs = ['plugin', 'update', parsed.id, parsed.version, ...forwardedFlags];
  } else {
    legacyArgs = ['plugin', 'install', spec, ...forwardedFlags];
  }
  await runLegacy(legacyArgs, ctx.file, approved);
  console.log('Install/update completed. Restart the client manually to activate changes.');
}

async function packageCommand(action, args) {
  if (action === 'init') {
    const result = await writeManifestTemplate(option(args, '--file', 'dsh-package.json'), option(args, '--type', 'plugin'), { id: option(args, '--id'), name: option(args, '--name') });
    return print(result);
  }
  const root = resolve(args[2] && !args[2].startsWith('--') ? args[2] : process.cwd());
  if (action === 'validate') {
    const found = await findPackageManifest(root);
    if (!found) throw new Error('no DSH package manifest found');
    print({ file: found.file, valid: found.valid, errors: found.errors, warnings: found.warnings, manifest: found.manifest });
    if (!found.valid) process.exitCode = 1;
    return;
  }
  if (action === 'audit') {
    const result = await auditPackageSecurity(root);
    print(result);
    if (!result.safe) process.exitCode = 1;
    return;
  }
  if (action === 'sbom') {
    const sbom = await generateSbom(root);
    const outputFile = resolve(args[3] || `${root}/sbom.cdx.json`);
    await writeFile(outputFile, `${JSON.stringify(sbom, null, 2)}\n`, 'utf8');
    return print({ generated: true, file: outputFile, components: sbom.components.length });
  }
  if (action === 'publish-check') {
    const found = await findPackageManifest(root);
    if (!found) throw new Error('no DSH package manifest found');
    const audit = await auditPackageSecurity(root);
    const security = found.manifest?.security || {};
    const missingEvidence = [];
    if (!security.provenance) missingEvidence.push('provenance');
    if (!security.signature) missingEvidence.push('signature');
    if (!security.sbom) missingEvidence.push('sbom');
    if (!security.license) missingEvidence.push('license');
    if (!found.manifest?.publisher?.id) missingEvidence.push('publisher.id');
    const result = {
      publishable: found.valid && audit.safe && missingEvidence.length === 0,
      manifest: { file: found.file, errors: found.errors, warnings: found.warnings },
      audit,
      missing_release_evidence: missingEvidence,
    };
    print(result);
    if (!result.publishable) process.exitCode = 1;
    return;
  }
  throw new Error(`unknown package action: ${action}`);
}

async function applyPackagePlan(kind, file, args) {
  const document = JSON.parse(await readFile(resolve(file), 'utf8'));
  const packages = document.packages || document.items || document.plugins || [];
  if (!Array.isArray(packages) || packages.length === 0) throw new Error(`${kind} has no packages`);
  const ctx = await registryContext(args);
  const runtimeRegistry = await readRuntimeRegistry();
  const simulatedInstalled = [...runtimeRegistry.plugins];
  const results = [];
  for (const entry of packages) {
    const request = typeof entry === 'string' ? { id: entry, version: '*', type: 'plugin' } : entry;
    const spec = `${request.id}@${request.version || '*'}`;
    const preflight = preflightPackage(ctx.registry, spec, { type: request.type || 'plugin', channel: request.channel, installed: simulatedInstalled });
    results.push(preflight);
    if (!preflight.allowed) throw new Error(`${kind} preflight failed for ${request.id}: ${preflight.reasons.join('; ')}`);
    for (const planned of preflight.package_checks || []) {
      if (!simulatedInstalled.some((record) => record.id === planned.id && record.state !== 'removed')) {
        simulatedInstalled.push({ id: planned.id, type: planned.type, version: planned.version, state: 'planned', provides: planned.provides || [], permissions: planned.permissions?.permissions || [] });
      }
    }
  }
  if (!has(args, '--dry-run')) {
    for (const preflight of results) {
      const synthetic = [preflight.type, 'install', `${preflight.id}@${preflight.version}`];
      if (preflight.channel) synthetic.push('--channel', preflight.channel);
      if (has(args, '--yes')) synthetic.push('--yes');
      await installOrUpdate(preflight.type, 'install', `${preflight.id}@${preflight.version}`, synthetic);
    }
  }
  print({ kind, file: resolve(file), dry_run: has(args, '--dry-run'), restart_required: !has(args, '--dry-run'), packages: results });
}

async function bridgeCommand(action, args) {
  if (action === 'parse') return print(parseDshUrl(args[2]));
  if (action === 'register') return print(await registerProtocolHandler({ dryRun: has(args, '--dry-run') }));
  if (action === 'serve') {
    const host = await startClientHost({ port: option(args, '--port') });
    console.log(`DSH client host listening on http://${host.host}:${host.port}`);
    return;
  }
  if (action === 'link') {
    const spec = parsePluginSpec(args[2], '*');
    return console.log(buildInstallDeepLink({ id: spec.id, version: spec.version, channel: option(args, '--channel'), type: option(args, '--type', 'plugin'), registry: option(args, '--registry') }));
  }
  if (action === 'handle') {
    const plan = deepLinkInstallPlan(args[2]);
    if (!has(args, '--yes')) {
      const approved = await confirm(`DSH Marketplace requests ${plan.request.action} of ${plan.request.id}@${plan.request.version}. Continue?`);
      if (!approved) return print({ ...plan, executed: false, reason: 'confirmation-required' });
    }
    const synthetic = [plan.request.type || 'plugin', plan.request.action === 'update' ? 'update' : 'install', `${plan.request.id}@${plan.request.version}`, '--yes'];
    if (plan.request.channel) synthetic.push('--channel', plan.request.channel);
    if (plan.request.registry) synthetic.push('--registry', plan.request.registry);
    await installOrUpdate(plan.request.type || 'plugin', plan.request.action === 'update' ? 'update' : 'install', `${plan.request.id}@${plan.request.version}`, synthetic);
    return;
  }
  throw new Error(`unknown bridge action: ${action}`);
}

async function localRecords(type, action, id, includeRemoved) {
  const registry = await readRuntimeRegistry();
  const records = registry.plugins.filter((entry) => (includeRemoved || entry.state !== 'removed') && (type === 'ecosystem' || recordType(entry) === type));
  if (action === 'list') return print(records.sort((a, b) => a.id.localeCompare(b.id)));
  if (action === 'status') {
    if (!id) return print(records.map(({ id: packageId, version, state, channel, enabled, activated, restart_required, health, type: packageType }) => ({ id: packageId, type: packageType || 'plugin', version, state, channel, enabled, activated, restart_required, health: health?.status || null })));
    const record = records.find((entry) => entry.id === id);
    if (!record) throw new Error(`${type} is not installed: ${id}`);
    return print(record);
  }
}

async function installedRecord(id) {
  const registry = await readRuntimeRegistry();
  return { registry, record: registry.plugins.find((entry) => entry.id === id && entry.state !== 'removed') };
}

async function assertInstalledType(type, id) {
  if (!id || type === 'plugin' || type === 'ecosystem') return;
  const { record } = await installedRecord(id);
  if (!record) throw new Error(`${type} is not installed: ${id}`);
  if (recordType(record) !== type) throw new Error(`package type mismatch: ${id} is ${recordType(record)}, not ${type}`);
}

async function repairPackage(type, id, args) {
  if (!id) throw new Error('repair requires a package id');
  await assertInstalledType(type, id);
  const { registry: runtimeRegistry, record } = await installedRecord(id);
  if (!record) throw new Error(`${type} is not installed: ${id}`);
  const ctx = await registryContext(args);
  const spec = `${id}@${record.version || '*'}`;
  const preflight = preflightPackage(ctx.registry, spec, { type, channel: record.channel, installed: runtimeRegistry.plugins });
  if (!preflight.allowed) throw new Error(`repair preflight failed: ${preflight.reasons.join('; ')}`);
  let approved = has(args, '--yes');
  if (preflight.permissions.requires_consent && !approved) approved = await confirm(`Repair may execute permissions ${preflight.permissions.permissions.join(', ')}. Continue?`);
  if (preflight.permissions.requires_consent && !approved) throw new Error('repair cancelled: explicit permission consent is required');
  return runLegacy(['plugin', 'repair', id, ...stripFlag(args.slice(3), '--yes')], ctx.file, approved);
}

async function ecosystemLifecycle(type, action, spec, args) {
  if (['install', 'add', 'update'].includes(action)) return installOrUpdate(type, action === 'add' ? 'install' : action, spec, args);
  if (action === 'list' || action === 'status') return localRecords(type, action, spec, has(args, '--all'));
  if (type === 'ecosystem') throw new Error(`ecosystem ${action} requires an explicit package type`);
  if (action === 'repair') return repairPackage(type, spec, args);
  if (!LOCAL_LIFECYCLE.has(action)) throw new Error(`unknown ${type} action: ${action}`);
  await assertInstalledType(type, spec);
  return runLegacy(['plugin', action, ...args.slice(2)]);
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'help';
  if (command === 'help' || command === '--help' || command === '-h') return help();
  if (command === 'version' || command === '--version' || command === '-v') return print(versionInfo());
  if (command === 'preflight') {
    const ctx = await registryContext(args);
    const runtimeRegistry = await readRuntimeRegistry();
    return print(preflightPackage(ctx.registry, args[1], { type: option(args, '--type'), channel: option(args, '--channel'), installed: runtimeRegistry.plugins }));
  }
  if (command === 'bridge') return bridgeCommand(args[1] || 'parse', args);
  if (command === 'package') return packageCommand(args[1] || 'validate', args);
  if (command === 'profile' && args[1] === 'apply') return applyPackagePlan('profile', args[2], args);
  if (command === 'bundle' && args[1] === 'install') return applyPackagePlan('bundle', args[2], args);
  if (ECOSYSTEM_TYPES.has(command) || command === 'ecosystem') return ecosystemLifecycle(command, args[1] || 'list', args[2], args);
  if (command === 'install') return installOrUpdate('plugin', 'install', args[1], ['plugin', 'install', ...args.slice(1)]);
  return runLegacy(args);
}

main().catch((error) => {
  console.error(`[dsh] ${error.stack || error.message}`);
  if (error.permissionReport) console.error(JSON.stringify(error.permissionReport, null, 2));
  if (error.compatibilityReport) console.error(JSON.stringify(error.compatibilityReport, null, 2));
  process.exit(1);
});
