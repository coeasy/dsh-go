export type SkillExecutionState =
  | 'installed'
  | 'ready'
  | 'executing'
  | 'completed'
  | 'failed';

export type SkillExecution = {
  skillId: string;
  state: SkillExecutionState;
};

export function startSkill(skillId: string): SkillExecution {
  return { skillId, state: 'executing' };
}
