import { cliJsonMode, printCliError, printCliValue } from './cli-output.mjs';
import { createEnvironmentLock, restoreEnvironmentLock, verifyEnvironmentLock } from './environment-lock.mjs';

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
  };
  let result;
  if (command === 'lock') result = await createEnvironmentLock(common);
  else if (command === 'verify-lock') result = await verifyEnvironmentLock(common);
  else if (command === 'restore') {
    result = await restoreEnvironmentLock({
      ...common,
      dryRun: args.includes('--dry-run'),
      approved: args.includes('--yes'),
    });
  } else throw new Error(`unknown environment command: ${command}`);

  if (cliJsonMode()) printCliValue(result, { command, argv: args });
  else console.log(JSON.stringify(result, null, 2));
  if (command === 'verify-lock' && !result.ok) process.exitCode = 1;
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runEnvironmentCli().catch((error) => {
    printCliError(error, { prefix: '[dsh-environment]', argv: process.argv.slice(2) });
    process.exitCode = 1;
  });
}
