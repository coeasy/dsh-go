const SAFE_HOST_ENV_KEYS = [
  'PATH',
  'Path',
  'HOME',
  'USERPROFILE',
  'HOMEDRIVE',
  'HOMEPATH',
  'SystemRoot',
  'SYSTEMROOT',
  'ComSpec',
  'COMSPEC',
  'PATHEXT',
  'TMP',
  'TEMP',
  'TMPDIR',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'TERM',
  'COLORTERM',
  'NO_COLOR',
  'FORCE_COLOR',
  'TZ',
];

function assignEnv(target, key, value) {
  if (value === undefined || value === null) return;
  target[String(key)] = String(value);
}

export function buildExecutionEnv(explicit = {}, hostEnv = process.env) {
  const env = {};
  for (const key of SAFE_HOST_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(hostEnv, key)) assignEnv(env, key, hostEnv[key]);
  }
  for (const [key, value] of Object.entries(explicit || {})) assignEnv(env, key, value);
  return env;
}

export function inheritedExecutionEnvKeys() {
  return [...SAFE_HOST_ENV_KEYS];
}
