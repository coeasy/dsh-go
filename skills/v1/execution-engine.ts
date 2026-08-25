import type { SkillExecutorRegistry } from './executor-registry';

export interface SkillExecutionContext {
  skillId: string;
  input: unknown;
  executorId?: string;
  registry?: SkillExecutorRegistry;
}

export interface SkillExecutionResult {
  success: boolean;
  state: 'completed' | 'failed';
  output?: unknown;
  error?: string;
}

export async function executeSkill(ctx: SkillExecutionContext): Promise<SkillExecutionResult> {
  if (!ctx.skillId.trim()) return { success: false, state: 'failed', error: 'skill id is required' };
  if (!ctx.registry) return { success: false, state: 'failed', error: 'skill executor registry is required' };
  const executorId = ctx.executorId ?? ctx.skillId;
  try {
    const output = await ctx.registry.run(executorId, ctx.input);
    return { success: true, state: 'completed', output };
  } catch (error) {
    return { success: false, state: 'failed', error: error instanceof Error ? error.message : String(error) };
  }
}
