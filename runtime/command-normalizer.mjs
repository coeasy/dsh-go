const PACKAGE_TYPES = new Set(['plugin', 'mcp', 'skill', 'agent']);

function explicitVersion(spec) {
  return String(spec || '').lastIndexOf('@') > 0;
}

function withLatestVersion(spec) {
  const value = String(spec || '').trim();
  if (!value || explicitVersion(value)) return value;
  return `${value}@*`;
}

function installSpecIndex(args) {
  if (PACKAGE_TYPES.has(args[0]) && ['install', 'add'].includes(args[1])) return 2;
  if (args[0] === 'package' && ['install', 'add'].includes(args[1])) return 2;
  if (args[0] === 'install') return 1;
  return -1;
}

export function normalizeDshInstallUri(raw) {
  if (!raw) return raw;
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    return raw;
  }
  if (url.protocol !== 'dsh:') return raw;

  if (url.hostname === 'install') {
    if (url.searchParams.get('id') && !url.searchParams.get('version')) {
      url.searchParams.set('version', '*');
      return url.toString();
    }
    for (const key of ['plugin', 'spec']) {
      const value = url.searchParams.get(key);
      if (value) {
        url.searchParams.set(key, withLatestVersion(value));
        return url.toString();
      }
    }
    return raw;
  }

  const segments = url.pathname.split('/').filter(Boolean);
  if (PACKAGE_TYPES.has(url.hostname) && segments.length === 2 && segments[0] === 'install') {
    segments[1] = encodeURIComponent(withLatestVersion(decodeURIComponent(segments[1])));
    url.pathname = `/${segments.join('/')}`;
    return url.toString();
  }

  if (url.hostname === 'package' && segments.length === 3 && segments[0] === 'install') {
    segments[2] = encodeURIComponent(withLatestVersion(decodeURIComponent(segments[2])));
    url.pathname = `/${segments.join('/')}`;
    return url.toString();
  }

  return raw;
}

export function normalizeInstallVersionArgs(input) {
  const args = [...(input || [])];
  if (args[0] === 'host' && args[1] === 'handle' && args[2]) {
    args[2] = normalizeDshInstallUri(args[2]);
    return args;
  }

  const index = installSpecIndex(args);
  if (index < 0) return args;
  const spec = args[index];
  if (!spec || String(spec).startsWith('--') || explicitVersion(spec)) return args;
  args[index] = withLatestVersion(spec);
  return args;
}
