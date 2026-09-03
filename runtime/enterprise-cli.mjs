import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { buildDesktopCenter } from './desktop-center.mjs';
import {
  enforceEnterprisePolicy,
  inspectEnterprisePolicy,
  normalizeEnterprisePolicy,
  readEnterprisePolicy,
  writeEnterprisePolicy,
} from './enterprise-policy.mjs';
import { inspectRegistries } from './registry-manager.mjs';
import { executePackageTransaction } from './transaction.mjs';
import { withNormalizedPackagePlan } from './plan-normalizer.mjs';
import { printCliValue } from './cli-output.mjs';

function option(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}
function has(args, name) { return args.includes(name); }

export function isEnterpriseCommand(args = []) {
  return args[0] === 'enterprise' || args[0] === 'organization';
}

async function policyCommand(args) {
  const action = args[2] || 'show';
  const target = option(args, '--file');
  if (action === 'show') return inspectEnterprisePolicy(target);
  const sourceFile = args[3];
  if (!sourceFile) throw new Error(`enterprise policy ${action} requires a JSON file`);
  const source = JSON.parse(await readFile(resolve(sourceFile), 'utf8'));
  const policy = normalizeEnterprisePolicy(source);
  if (action === 'validate') return { valid: true, file: resolve(sourceFile), policy };
  if (action === 'apply') {
    if (!has(args, '--yes')) {
      const error = new Error('enterprise policy apply requires explicit --yes approval');
      error.code = 'DSH_APPROVAL_REQUIRED';
      throw error;
    }
    return writeEnterprisePolicy(policy, target);
  }
  throw new Error(`unknown enterprise policy action: ${action}`);
}

async function organizationPlan(args) {
  const kind = args[1];
  const expected = kind === 'profile' ? 'apply' : kind === 'bundle' ? 'install' : null;
  if (!expected || args[2] !== expected) throw new Error('organization command must be profile apply or bundle install');
  const file = args[3];
  if (!file) throw new Error(`organization ${kind} ${expected} requires a JSON file`);
  const policyFile = option(args, '--policy-file');
  const policy = await readEnterprisePolicy(policyFile);
  const organization = option(args, '--organization', policy.organization || undefined);
  const planId = option(args, '--id', basename(file, '.json'));
  await enforceEnterprisePolicy({
    organization,
    plan_kind: kind,
    plan_id: planId,
    approved: has(args, '--yes'),
  }, { policy });
  return withNormalizedPackagePlan(file, (normalizedFile) => executePackageTransaction(normalizedFile, {
    kind,
    organization,
    planId,
    enterprisePolicy: policy,
    catalog: option(args, '--registry', 'catalog/registry-v3.json'),
    registryFile: option(args, '--runtime-registry'),
    approved: has(args, '--yes'),
    dryRun: has(args, '--dry-run'),
  }));
}

export async function runEnterpriseCli(args = process.argv.slice(2)) {
  let result;
  if (args[0] === 'organization') result = await organizationPlan(args);
  else {
    const action = args[1] || 'status';
    if (action === 'policy') result = await policyCommand(args);
    else if (action === 'status') {
      const policy = await inspectEnterprisePolicy(option(args, '--policy-file'));
      const registries = await inspectRegistries({ file: option(args, '--registries-file'), allowStale: true });
      result = {
        schema_version: 1,
        organization: policy.policy.organization,
        policy,
        registries,
        desktop: await buildDesktopCenter({
          runtimeRegistry: option(args, '--runtime-registry'),
          catalog: option(args, '--registry', 'catalog/registry-v3.json'),
          enterprisePolicyFile: option(args, '--policy-file'),
        }),
      };
    } else throw new Error(`unknown enterprise action: ${action}`);
  }
  printCliValue(result, { argv: args });
  return result;
}
