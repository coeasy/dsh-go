export interface DependencyNode {
  id: string;
  dependencies?: string[];
}

export function resolveDependencies(nodes: DependencyNode[], target: string): string[] {
  const result: string[] = [];
  const visit = (id: string) => {
    const node = nodes.find((item) => item.id === id);
    if (!node) return;
    for (const dep of node.dependencies ?? []) visit(dep);
    if (!result.includes(id)) result.push(id);
  };
  visit(target);
  return result;
}
