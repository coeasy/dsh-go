export type SkillState = 'installed' | 'loaded' | 'ready' | 'running' | 'completed' | 'failed';

export interface SkillLifecycle {
  id: string;
  state: SkillState;
  error?: string;
}

const TRANSITIONS: Record<SkillState, SkillState[]> = {
  installed: ['loaded', 'failed'],
  loaded: ['ready', 'failed'],
  ready: ['running', 'failed'],
  running: ['completed', 'failed'],
  completed: ['ready'],
  failed: ['ready'],
};

export function transitionSkill(lifecycle: SkillLifecycle, next: SkillState, error?: string): SkillLifecycle {
  if (!TRANSITIONS[lifecycle.state].includes(next)) {
    throw new Error(`invalid skill transition: ${lifecycle.state} -> ${next}`);
  }
  return { id: lifecycle.id, state: next, error: next === 'failed' ? error ?? 'skill execution failed' : undefined };
}
