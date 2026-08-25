export interface DependencyNode {
  id: string;
  dependencies?: string[];
}

export function resolveDependencies(nodes: DependencyNode[], target: string): string[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const result: string[] = [];
  const visited = new Set<string>();
  const visiting: string[] = [];

  const visit = (id: string): void => {
    if (visited.has(id)) return;
    const cycleIndex = visiting.indexOf(id);
    if (cycleIndex >= 0) throw new Error(`dependency cycle: ${[...visiting.slice(cycleIndex), id].join(' -> ')}`);
    const node = byId.get(id);
    if (!node) throw new Error(`dependency not found: ${id}`);
    visiting.push(id);
    for (const dependency of node.dependencies ?? []) visit(dependency);
    visiting.pop();
    visited.add(id);
    result.push(id);
  };

  visit(target);
  return result;
}
