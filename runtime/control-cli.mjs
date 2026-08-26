#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import {
  inspectSkill,
  invokeMcp,
  invokeSkill,
  loadSkill,
  mcpStatus,
  probeMcp,
  readMcpLogs,
  startMcp,
  unloadSkill,
} from './execution.mjs';
import { restartMcpSafely, stopMcpSafely } from './mcp-process.mjs';
import { readPackageConfig, redactConfig, setPackageConfig, unsetPackageConfig } from './config-store.mjs';
import { deleteSecret, getSecret, listSecrets, setSecret } from './secret-store.mjs';
import { planRuntimeRemoval, removeRuntimePackageSafe } from './dependency-guard.mjs';
import { executePackageTransaction, recoverPackageTransactions } from './transaction.mjs';
import { assertPackageType } from './package-model.mjs';

const args = process.argv.slice(2);

function option(name, fallback = undefined) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}
function has(name) { return args.includes(name); }
function print(value) { console.log(JSON.stringify(value, null, 2)); }

async function inputValue() {
  const file = option('--input-file');
  const raw = file ? await readFile(file, 'utf8') : option('--input', '{}');
  try { return JSON.parse(raw); } catch { throw new Error('input must be valid JSON'); }
}

async function configCommand(type) {
  const action = args[2];
  const id = args[3];
  if (!id) throw new Error(`${type} config requires package id`);
  if (action === 'get') return print({ type, id, config: redactConfig(await readPackageConfig(type, id)) });
  if (action === 'set') {
    const key = args[4];
    if (!key || args[5] === undefined) throw new Error(`${type} config set requires id, key and value`);
    return print(await setPackageConfig(type, id, key, args[5]));
  }
  if (action === 'unset') {
    const key = args[4];
    if (!key) throw new Error(`${type} config unset requires id and key`);
    return print(await unsetPackageConfig(type, id, key));
  }
  throw new Error(`unknown ${type} config action: ${action}`);
}

async function secretCommand() {
  const action = args[1] || 'list';
  if (action === 'list') return print({ secrets: await listSecrets() });
  const name = args[2];
  if (!name) throw new Error(`secret ${action} requires name`);
  if (action === 'set') {
    const value = option('--value') ?? process.env.DSH_SECRET_VALUE;
    if (!value) throw new Error('secret set requires --value or DSH_SECRET_VALUE');
    return print(await setSecret(name, value));
  }
  if (action === 'get') {
    const value = await getSecret(name);
    return print({ name, exists: value !== null, value: has('--show') ? value : value === null ? null : '<secret>' });
  }
  if (action === 'delete' || action === 'remove') return print(await deleteSecret(name));
  throw new Error(`unknown secret action: ${action}`);
}

async function mcpCommand() {
  const action = args[1];
  const id = args[2];
  if (action === 'config') return configCommand('mcp');
  if (!id) throw new Error(`mcp ${action || '<action>'} requires id`);
  const options = { timeoutMs: Number(option('--timeout')) || undefined, maxBytes: Number(option('--max-bytes')) || undefined };
  if (action === 'start') return print(await startMcp(id, options));
  if (action === 'stop') return print(await stopMcpSafely(id, options));
  if (action === 'restart') return print(await restartMcpSafely(id, options));
  if (action === 'status' || action === 'process-status') return print(await mcpStatus(id, options));
  if (action === 'logs') return print(await readMcpLogs(id, options));
  if (action === 'probe') return print(await probeMcp(id, options));
  if (action === 'invoke') {
    const tool = args[3];
    if (!tool) throw new Error('mcp invoke requires tool name');
    return print(await invokeMcp(id, tool, await inputValue(), options));
  }
  if (action === 'remove' || action === 'uninstall') {
    if (has('--dry-run')) return print(await planRuntimeRemoval('mcp', id, { cascade: has('--cascade') }));
    return print(await removeRuntimePackageSafe('mcp', id, { cascade: has('--cascade') }));
  }
  throw new Error(`unknown mcp control action: ${action}`);
}

async function skillCommand() {
  const action = args[1];
  const id = args[2];
  if (action === 'config') return configCommand('skill');
  if (!id) throw new Error(`skill ${action || '<action>'} requires id`);
  const options = { timeoutMs: Number(option('--timeout')) || undefined };
  if (action === 'load') return print(await loadSkill(id, options));
  if (action === 'unload') return print(await unloadSkill(id, options));
  if (action === 'inspect' || action === 'status-runtime') return print(await inspectSkill(id, options));
  if (action === 'invoke') return print(await invokeSkill(id, await inputValue(), options));
  if (action === 'remove' || action === 'uninstall') {
    if (has('--dry-run')) return print(await planRuntimeRemoval('skill', id, { cascade: has('--cascade') }));
    return print(await removeRuntimePackageSafe('skill', id, { cascade: has('--cascade') }));
  }
  throw new Error(`unknown skill control action: ${action}`);
}

async function typedRemoval(type) {
  const action = args[1];
  const id = args[2];
  if (!['remove', 'uninstall'].includes(action)) throw new Error(`unsupported control action: ${type} ${action}`);
  if (!id) throw new Error(`${type} remove requires id`);
  if (has('--dry-run')) return print(await planRuntimeRemoval(type, id, { cascade: has('--cascade') }));
  return print(await removeRuntimePackageSafe(type, id, { cascade: has('--cascade') }));
}

async function planCommand(kind) {
  const expected = kind === 'profile' ? 'apply' : 'install';
  if (args[1] !== expected) throw new Error(`unknown ${kind} action: ${args[1]}`);
  const file = args[2];
  if (!file) throw new Error(`${kind} ${expected} requires a JSON file`);
  return print(await executePackageTransaction(file, {
    kind,
    catalog: option('--registry', 'catalog/registry-v3.json'),
    approved: has('--yes'),
    dryRun: has('--dry-run'),
  }));
}

async function main() {
  const command = args[0];
  if (command === 'secret') return secretCommand();
  if (command === 'mcp') return mcpCommand();
  if (command === 'skill') return skillCommand();
  if (command === 'plugin' || command === 'agent') {
    if (args[1] === 'config') return configCommand(assertPackageType(command));
    if (args[1] === 'remove' || args[1] === 'uninstall') return typedRemoval(assertPackageType(command));
  }
  if (command === 'profile') return planCommand('profile');
  if (command === 'bundle') return planCommand('bundle');
  if (command === 'transaction' && args[1] === 'recover') return print(await recoverPackageTransactions());
  throw new Error(`unknown runtime control command: ${args.join(' ')}`);
}

main().catch((error) => {
  console.error(`[dsh-control] ${error.stack || error.message}`);
  if (error.permissionReport) console.error(JSON.stringify(error.permissionReport, null, 2));
  if (error.policyResult) console.error(JSON.stringify({ policy: error.policyResult }, null, 2));
  if (error.dependents) console.error(JSON.stringify({ dependents: error.dependents }, null, 2));
  process.exit(1);
});
