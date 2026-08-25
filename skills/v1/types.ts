export interface SkillDependencyReference {
  id: string;
  optional?: boolean;
}

export interface SkillManifest {
  id: string;
  version: string;
  dependencies: Array<string | SkillDependencyReference>;
  executor: string;
}
