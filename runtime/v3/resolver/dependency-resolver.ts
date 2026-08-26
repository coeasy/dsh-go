import type { RuntimePackageType } from '../storage/registry-store';

export interface DependencyRef {
  id: string;
  type?: RuntimePackageType;
}

export interface DependencyNode {
  id: string;
  type?: RuntimePackageType;
  dependencies?: Array<string | DependencyRef>;
}

function key(type: RuntimePackageType, id: string): string {
  return `${type}:${id}`;
}

function normalizeDependency(value: string | DependencyRef): Required<DependencyRef> {
  if (typeof value !== 'string') return { id: value.id, type: value.type ?? 'plugin' };
  const colon = value.indexOf(':');
  if (colon > 0) {
    const prefix = value.slice(0, colon) as RuntimePackageType;
    if (['plugin', 'mcp', 'skill', 'agent'].includes(prefix)) return { type: prefix, id: value.slice(colon + 1) };
  }
  return { type: 'plugin', id: value };
}

export function resolvePackageDependencies(nodes: DependencyNode[], target: DependencyRef): string[] {
  const byKey = new Map(nodes.map((node) => [key(node.type ?? 'plugin', node.id), node]));
  const result: string[] = [];
  const visited = new Set<string>();
  const visiting: string[] = [];

  const visit = (type: RuntimePackageType, id: string): void => {
    const packageKey = key(type, id);
    if (visited.has(packageKey)) return;
    const cycleIndex = visiting.indexOf(packageKey);
    if (cycleIndex >= 0) throw new Error(`dependency cycle: ${[...visiting.slice(cycleIndex), packageKey].join(' -> ')}`);
    const node = byKey.get(packageKey);
    if (!node) throw new Error(`dependency not found: ${packageKey}`);
    visiting.push(packageKey);
    for (const rawDependency of node.dependencies ?? []) {
      const dependency = normalizeDependency(rawDependency);
      visit(dependency.type, dependency.id);
    }
    visiting.pop();
    visited.add(packageKey);
    result.push(packageKey);
  };

  visit(target.type ?? 'plugin', target.id);
  return result;
}

export function resolveDependencies(nodes: DependencyNode[], target: string): string[] {
  return resolvePackageDependencies(nodes, { type: 'plugin', id: target })
    .map((packageKey) => packageKey.startsWith('plugin:') ? packageKey.slice('plugin:'.length) : packageKey);
}
