export type SkillExecutionState = 'installed' | 'ready' | 'executing' | 'completed' | 'failed';

export type SkillExecution = {
  skillId: string;
  state: SkillExecutionState;
  output?: unknown;
  error?: string;
};

export function startSkill(skillId: string): SkillExecution {
  if (!skillId.trim()) return { skillId, state: 'failed', error: 'skill id is required' };
  return { skillId, state: 'executing' };
}

export function completeSkill(execution: SkillExecution, output: unknown): SkillExecution {
  return { ...execution, state: 'completed', output, error: undefined };
}

export function failSkill(execution: SkillExecution, error: unknown): SkillExecution {
  return { ...execution, state: 'failed', error: error instanceof Error ? error.message : String(error) };
}
