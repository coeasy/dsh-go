import {
  ERROR_CODES,
  ProtocolError,
  compareVersion,
  normalizePackageRequest,
  normalizePackageType,
  packageKey,
  satisfiesRange,
} from '../protocol-core/index.mjs';

function advisoryApplies(advisory, type, id, version) {
  if (!advisory) return false;
  const target = advisory.package || {};
  if (target.type && normalizePackageType(target.type) !== type) return false;
  if (target.id && String(target.id).toLowerCase() !== id) return false;
  return satisfiesRange(version, advisory.affected || '*');
}

function blockedReason(registry, pkg, release) {
  if (release.revoked === true || release.security?.revoked === true) return { code: ERROR_CODES.PACKAGE_REVOKED, reason: 'revoked' };
  if (release.yanked === true || release.security?.yanked === true) return { code: ERROR_CODES.PACKAGE_YANKED, reason: 'yanked' };
  const advisories = [
    ...(Array.isArray(registry.advisories) ? registry.advisories : []),
    ...(Array.isArray(release.security?.advisories) ? release.security.advisories.map((item) => ({ ...item, package: { type: pkg.type, id: pkg.id } })) : []),
  ];
  const critical = advisories.find((advisory) => String(advisory?.severity || '').toLowerCase() === 'critical' && advisoryApplies(advisory, pkg.type, pkg.id, release.version));
  if (critical) return { code: ERROR_CODES.SECURITY_ADVISORY_BLOCKED, reason: `critical-advisory:${critical.id || 'unknown'}`, advisory: critical };
  return null;
}

function compatible(release, environment) {
  const policy = release.compatibility || {};
  if (policy.dsh && environment.dsh_version && !satisfiesRange(environment.dsh_version, policy.dsh)) return false;
  if (policy.runtime && environment.runtime_version && !satisfiesRange(environment.runtime_version, policy.runtime)) return false;
  if (Array.isArray(policy.os) && environment.os && !policy.os.map((item) => String(item).toLowerCase()).includes(String(environment.os).toLowerCase())) return false;
  if (Array.isArray(policy.arch) && environment.arch && !policy.arch.map((item) => String(item).toLowerCase()).includes(String(environment.arch).toLowerCase())) return false;
  return true;
}

function packageMap(registry) {
  if (!registry || Number(registry.schema_version) !== 4 || !Array.isArray(registry.packages)) {
    throw new Error('Resolver V2 requires Registry V4');
  }
  return new Map(registry.packages.map((item) => [packageKey(item.type, item.id), item]));
}

function dependencyRequest(dependency, channel) {
  return normalizePackageRequest({
    type: dependency.type,
    id: dependency.id,
    range: dependency.range || '*',
    channel: dependency.channel || channel,
  });
}

function chooseRelease(registry, pkg, request, environment) {
  const blocked = [];
  const compatibleCandidates = [];
  for (const release of pkg.releases || []) {
    if (String(release.channel || 'stable') !== request.channel) continue;
    if (!satisfiesRange(release.version, request.range)) continue;
    const reason = blockedReason(registry, pkg, release);
    if (reason) {
      blocked.push({ release, ...reason });
      continue;
    }
    if (!compatible(release, environment)) continue;
    compatibleCandidates.push(release);
  }
  compatibleCandidates.sort((left, right) => compareVersion(right.version, left.version));
  if (compatibleCandidates.length) return { release: compatibleCandidates[0], blocked };
  if (blocked.length) {
    const strongest = blocked.find((item) => item.code === ERROR_CODES.PACKAGE_REVOKED)
      || blocked.find((item) => item.code === ERROR_CODES.SECURITY_ADVISORY_BLOCKED)
      || blocked[0];
    throw new ProtocolError(strongest.code, `package is blocked by security policy: ${packageKey(pkg.type, pkg.id)}@${request.range}`, {
      blocked: blocked.map((item) => ({ version: item.release.version, reason: item.reason })),
    });
  }
  throw new ProtocolError(ERROR_CODES.PACKAGE_NOT_FOUND, `no compatible release satisfies ${packageKey(pkg.type, pkg.id)}@${request.range} [${request.channel}]`);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function fnv1a64(value) {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * prime);
  }
  return hash.toString(16).padStart(16, '0');
}

export function resolutionHash(plan) {
  return `r2-${fnv1a64(stableStringify({
    registry_revision: plan.registry_revision,
    root: plan.root,
    graph: plan.graph,
    order: plan.order,
    environment: plan.environment,
  }))}`;
}

export function resolvePackage(registry, rawRequest, environment = {}) {
  const rootRequest = normalizePackageRequest(rawRequest);
  const packages = packageMap(registry);
  const constraints = new Map();
  const nodes = new Map();
  const visiting = [];
  const visited = new Set();

  function addConstraint(request, parent = null, optional = false) {
    const key = packageKey(request.type, request.id);
    const current = constraints.get(key) || [];
    current.push({ range: request.range, channel: request.channel, parent, optional });
    constraints.set(key, current);
    return key;
  }

  function effectiveRequest(key) {
    const list = constraints.get(key) || [];
    const [type, ...idParts] = key.split(':');
    const id = idParts.join(':');
    const channels = [...new Set(list.map((entry) => entry.channel))];
    if (channels.length !== 1) {
      throw new ProtocolError(ERROR_CODES.DEPENDENCY_CONFLICT, `dependency channel conflict for ${key}`, { constraints: list });
    }
    return {
      type,
      id,
      channel: channels[0],
      ranges: list.map((entry) => entry.range),
    };
  }

  function selectForConstraints(key) {
    const request = effectiveRequest(key);
    const pkg = packages.get(key);
    if (!pkg) throw new ProtocolError(ERROR_CODES.PACKAGE_NOT_FOUND, `package not found in Registry V4: ${key}`);
    const candidates = (pkg.releases || [])
      .filter((release) => String(release.channel || 'stable') === request.channel)
      .filter((release) => request.ranges.every((range) => satisfiesRange(release.version, range)))
      .filter((release) => !blockedReason(registry, pkg, release))
      .filter((release) => compatible(release, environment))
      .sort((left, right) => compareVersion(right.version, left.version));
    if (!candidates.length) {
      throw new ProtocolError(ERROR_CODES.DEPENDENCY_CONFLICT, `no release satisfies merged dependency constraints for ${key}`, { constraints: request.ranges });
    }
    return { pkg, release: candidates[0] };
  }

  function visit(key) {
    if (visiting.includes(key)) {
      const cycle = [...visiting.slice(visiting.indexOf(key)), key];
      throw new ProtocolError(ERROR_CODES.DEPENDENCY_CONFLICT, `dependency cycle detected: ${cycle.join(' -> ')}`, { cycle });
    }
    const selected = selectForConstraints(key);
    const existing = nodes.get(key);
    if (existing && existing.version === selected.release.version && visited.has(key)) return;

    visiting.push(key);
    const dependencies = [];
    for (const dependency of selected.release.dependencies || []) {
      const request = dependencyRequest(dependency, selected.release.channel || 'stable');
      const depKey = addConstraint(request, key, dependency.optional === true);
      if (dependency.optional === true && !packages.has(depKey)) continue;
      dependencies.push(depKey);
      visit(depKey);
    }
    visiting.pop();
    visited.add(key);
    nodes.set(key, {
      key,
      type: selected.pkg.type,
      id: selected.pkg.id,
      version: selected.release.version,
      channel: selected.release.channel,
      commit: selected.release.commit,
      artifact: selected.release.artifact || {},
      permissions: [...(selected.release.permissions || [])].sort(),
      compatibility: selected.release.compatibility || {},
      security: selected.release.security || {},
      dependencies: dependencies.sort(),
      publisher_id: selected.pkg.publisher_id,
      source: selected.pkg.source,
    });
  }

  const rootKey = addConstraint(rootRequest);
  const rootPackage = packages.get(rootKey);
  if (!rootPackage) throw new ProtocolError(ERROR_CODES.PACKAGE_NOT_FOUND, `package not found in Registry V4: ${rootKey}`);
  const rootSelection = chooseRelease(registry, rootPackage, rootRequest, environment);
  nodes.set(rootKey, {
    key: rootKey,
    type: rootPackage.type,
    id: rootPackage.id,
    version: rootSelection.release.version,
    channel: rootSelection.release.channel,
    commit: rootSelection.release.commit,
    artifact: rootSelection.release.artifact || {},
    permissions: [...(rootSelection.release.permissions || [])].sort(),
    compatibility: rootSelection.release.compatibility || {},
    security: rootSelection.release.security || {},
    dependencies: [],
    publisher_id: rootPackage.publisher_id,
    source: rootPackage.source,
  });
  visit(rootKey);

  const order = [];
  const ordered = new Set();
  function append(key) {
    if (ordered.has(key)) return;
    const node = nodes.get(key);
    for (const dependency of node?.dependencies || []) append(dependency);
    ordered.add(key);
    order.push(key);
  }
  append(rootKey);

  const graph = [...nodes.values()].sort((a, b) => a.key.localeCompare(b.key));
  const permissionSet = new Set();
  for (const node of graph) for (const permission of node.permissions) permissionSet.add(permission);
  const plan = {
    protocol_version: 2,
    registry_revision: registry.revision,
    root: nodes.get(rootKey),
    graph,
    order,
    permissions: [...permissionSet].sort(),
    conflicts: [],
    restart_required: true,
    environment: { ...environment },
  };
  return Object.freeze({ ...plan, resolution_hash: resolutionHash(plan) });
}
