export interface SkillExecutionContext {
  skillId: string;
  input: unknown;
}

export interface SkillExecutionResult {
  success: boolean;
}

export function executeSkill(ctx: SkillExecutionContext): SkillExecutionResult {
  return { success: Boolean(ctx.skillId) };
}
