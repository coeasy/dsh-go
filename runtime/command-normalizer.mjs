const PACKAGE_TYPES = new Set(['plugin', 'mcp', 'skill', 'agent']);

function explicitVersion(spec) {
  return String(spec || '').lastIndexOf('@') > 0;
}

function installSpecIndex(args) {
  if (PACKAGE_TYPES.has(args[0]) && ['install', 'add'].includes(args[1])) return 2;
  if (args[0] === 'package' && ['install', 'add'].includes(args[1])) return 2;
  if (args[0] === 'install') return 1;
  return -1;
}

export function normalizeInstallVersionArgs(input) {
  const args = [...(input || [])];
  const index = installSpecIndex(args);
  if (index < 0) return args;
  const spec = args[index];
  if (!spec || String(spec).startsWith('--') || explicitVersion(spec)) return args;
  args[index] = `${spec}@*`;
  return args;
}
