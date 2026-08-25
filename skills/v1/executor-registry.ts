export interface SkillExecutor {
  id: string;
  execute(input: unknown): unknown;
}

export class SkillExecutorRegistry {
  private executors = new Map<string, SkillExecutor>();

  register(executor: SkillExecutor) {
    this.executors.set(executor.id, executor);
  }

  run(id: string, input: unknown) {
    return this.executors.get(id)?.execute(input);
  }
}
