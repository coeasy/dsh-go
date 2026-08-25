export interface RuntimeNode {
  id: string;
  dependencies?: string[];
}

export interface RuntimePlan {
  order: string[];
}

export class RuntimeResolver {
  resolve(nodes: RuntimeNode[]): RuntimePlan {
    const visited = new Set<string>();
    const order: string[] = [];

    const visit = (node: RuntimeNode) => {
      if (visited.has(node.id)) return;
      visited.add(node.id);
      for (const dep of node.dependencies ?? []) {
        const dependency = nodes.find((item) => item.id === dep);
        if (dependency) visit(dependency);
      }
      order.push(node.id);
    };

    for (const node of nodes) visit(node);

    return { order };
  }
}
