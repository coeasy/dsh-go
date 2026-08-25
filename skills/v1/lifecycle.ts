export type SkillState = 'installed' | 'loaded' | 'running' | 'failed';

export interface SkillLifecycle {
  id: string;
  state: SkillState;
}
