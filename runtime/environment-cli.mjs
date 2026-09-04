import { createEnvironmentLock, verifyEnvironmentLock } from './environment-lock.mjs';
import { supervisedEnvironmentRestore } from './supervisor.mjs';

function option(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

export function isEnvironmentCommand(args = []) {
  return ['lock', 'restore', 'verify-lock'].includes(args[0]);
}

export async function runEnvironmentCli(args = process.argv.slice(2)) {
  const command = args[0];
  const common = {
    lockFile: option(args, '--file') || option(args, '--lock-file'),
    registryFile: option(args, '--runtime-registry'),
    storeRoot: option(args, '--store'),
    source: 'cli',
  };
  let result;
  if (command === 'lock') result = await createEnvironmentLock(common);
  else if (command === 'verify-lock') result = await verifyEnvironmentLock(common);
  else if (command === 'restore') {
    result = await supervisedEnvironmentRestore({
      ...common,
      dryRun: args.includes('--dry-run'),
      approved: args.includes('--yes'),
    });
  } else throw new Error(`unknown environment command: ${command}`);

  if (command === 'verify-lock' && !result.ok) process.exitCode = 1;
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runEnvironmentCli().then((result) => {
    console.log(JSON.stringify(result, null, 2));
  }).catch((error) => {
    console.error(`[dsh-environment] ${error.code ? `${error.code}: ` : ''}${error.message}`);
    process.exitCode = 1;
  });
}
