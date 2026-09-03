export const CLI_JSON_SCHEMA_VERSION = 1;

export function cliJsonMode(env = process.env) {
  return env.DSH_OUTPUT_JSON === '1';
}

export function cliCommandName(argv = process.argv.slice(2)) {
  return argv.filter((value, index, values) => {
    if (value === '--json') return false;
    if (value === '--lang') return false;
    if (index > 0 && values[index - 1] === '--lang') return false;
    return !String(value).startsWith('--lang=');
  }).filter((value) => !String(value).startsWith('--')).slice(0, 3).join(' ') || 'dsh';
}

export function formatCliSuccess(data, options = {}) {
  return {
    schema_version: CLI_JSON_SCHEMA_VERSION,
    ok: true,
    command: options.command || cliCommandName(options.argv),
    data,
  };
}

function errorDetails(error) {
  const details = {};
  if (error?.permissionReport) details.permission_report = error.permissionReport;
  if (error?.compatibilityReport) details.compatibility_report = error.compatibilityReport;
  if (error?.dependents) details.dependents = error.dependents;
  if (error?.supported_languages) details.supported_languages = error.supported_languages;
  if (error?.rollback_restored != null) details.rollback_restored = Boolean(error.rollback_restored);
  if (error?.rollback_package) details.rollback_package = error.rollback_package;
  return details;
}

export function formatCliError(error, options = {}) {
  const details = errorDetails(error);
  return {
    schema_version: CLI_JSON_SCHEMA_VERSION,
    ok: false,
    command: options.command || cliCommandName(options.argv),
    error: {
      code: error?.code || options.defaultCode || 'DSH_CLI_ERROR',
      message: error?.message || String(error || 'unknown error'),
      ...(Object.keys(details).length ? { details } : {}),
    },
  };
}

export function printCliValue(value, options = {}) {
  const payload = cliJsonMode(options.env)
    ? formatCliSuccess(value, options)
    : value;
  console.log(JSON.stringify(payload, null, 2));
  return value;
}

export function printCliMessage(message, options = {}) {
  if (cliJsonMode(options.env)) return;
  console.log(message);
}

export function printCliError(error, options = {}) {
  if (cliJsonMode(options.env)) {
    console.error(JSON.stringify(formatCliError(error, options), null, 2));
    return;
  }
  console.error(`${options.prefix || '[dsh]'} ${error?.stack || error?.message || String(error)}`);
  if (error?.permissionReport) console.error(JSON.stringify(error.permissionReport, null, 2));
  if (error?.compatibilityReport) console.error(JSON.stringify(error.compatibilityReport, null, 2));
  if (error?.dependents) console.error(JSON.stringify({ dependents: error.dependents }, null, 2));
}
