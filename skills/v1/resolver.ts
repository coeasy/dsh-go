import type { SkillManifest } from './types';

export interface SkillDependency {
  id: string;
  dependencies: string[];
}

function dependencyId(value: string | { id: string }): string {
  return typeof value === 'string' ? value : value.id;
}

export class SkillResolver {
  constructor(private readonly catalog: SkillManifest[] = []) {}

  resolve(skill: SkillDependency | SkillManifest): string[] {
    const catalog = new Map(this.catalog.map((manifest) => [manifest.id, manifest]));
    const order: string[] = [];
    const visited = new Set<string>();
    const visiting: string[] = [];

    const dependenciesFor = (id: string): string[] => {
      if (id === skill.id) return skill.dependencies.map(dependencyId);
      const manifest = catalog.get(id);
      if (!manifest) throw new Error(`skill dependency not found: ${id}`);
      return manifest.dependencies.map(dependencyId);
    };

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      const cycleIndex = visiting.indexOf(id);
      if (cycleIndex >= 0) throw new Error(`skill dependency cycle: ${[...visiting.slice(cycleIndex), id].join(' -> ')}`);
      visiting.push(id);
      for (const dependency of dependenciesFor(id)) visit(dependency);
      visiting.pop();
      visited.add(id);
      order.push(id);
    };

    visit(skill.id);
    return order;
  }
}
