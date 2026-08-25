export type RuntimeDependency = {
  id: string;
  version: string;
  dependencies?: string[];
};

export type RuntimePlan = {
  loadOrder: string[];
  dependencies: RuntimeDependency[];
};

export function resolveRuntime(items: RuntimeDependency[]): RuntimePlan {
  const visited = new Set<string>();
  const loadOrder: string[] = [];

  function visit(item: RuntimeDependency) {
    if (visited.has(item.id)) return;
    visited.add(item.id);
    (item.dependencies || []).forEach((dep) => {
      const target = items.find((x) => x.id === dep);
      if (target) visit(target);
    });
    loadOrder.push(item.id);
  }

  items.forEach(visit);

  return { loadOrder, dependencies: items };
}
