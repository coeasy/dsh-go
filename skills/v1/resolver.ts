export interface SkillDependency {
  id: string;
  dependencies: string[];
}

export class SkillResolver {
  resolve(skill: SkillDependency): string[] {
    return [skill.id, ...skill.dependencies];
  }
}
