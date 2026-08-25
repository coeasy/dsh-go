function parse(version) {
  const match = String(version || '').trim().replace(/^v/, '').match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || '',
  };
}

export function compareVersions(a, b) {
  const left = parse(a);
  const right = parse(b);
  if (!left || !right) throw new Error(`invalid semantic version comparison: ${a}, ${b}`);
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (left.prerelease === right.prerelease) return 0;
  if (!left.prerelease) return 1;
  if (!right.prerelease) return -1;
  return left.prerelease.localeCompare(right.prerelease, undefined, { numeric: true });
}

function wildcardMatch(version, range) {
  const v = parse(version);
  if (!v) return false;
  const parts = String(range).replace(/^v/, '').split('.');
  const actual = [v.major, v.minor, v.patch];
  return parts.every((part, index) => ['x', 'X', '*'].includes(part) || Number(part) === actual[index]);
}

function comparator(version, token) {
  const raw = token.trim();
  if (!raw || raw === '*' || raw.toLowerCase() === 'latest') return true;
  if (/[xX*]/.test(raw)) return wildcardMatch(version, raw);
  if (raw.startsWith('^')) {
    const base = parse(raw.slice(1));
    const current = parse(version);
    if (!base || !current || compareVersions(version, raw.slice(1)) < 0) return false;
    if (base.major > 0) return current.major === base.major;
    if (base.minor > 0) return current.major === 0 && current.minor === base.minor;
    return current.major === 0 && current.minor === 0 && current.patch === base.patch;
  }
  if (raw.startsWith('~')) {
    const base = parse(raw.slice(1));
    const current = parse(version);
    return Boolean(base && current && compareVersions(version, raw.slice(1)) >= 0 && current.major === base.major && current.minor === base.minor);
  }
  const match = raw.match(/^(>=|<=|>|<|=)?\s*(.+)$/);
  if (!match) return false;
  const op = match[1] || '=';
  const target = match[2];
  if (!parse(target)) return false;
  const cmp = compareVersions(version, target);
  return op === '>=' ? cmp >= 0 : op === '<=' ? cmp <= 0 : op === '>' ? cmp > 0 : op === '<' ? cmp < 0 : cmp === 0;
}

export function satisfiesVersion(version, range = '*') {
  const expression = String(range || '*').trim();
  return expression.split('||').some((group) => group.trim().split(/\s+/).every((token) => comparator(version, token)));
}

export function selectHighestVersion(versions, range = '*') {
  const matches = versions.filter((version) => satisfiesVersion(version, range));
  return matches.sort(compareVersions).at(-1) || null;
}
