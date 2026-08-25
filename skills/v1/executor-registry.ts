export interface SkillExecutor {
  id: string;
  execute(input: unknown): unknown | Promise<unknown>;
}

export class SkillExecutorRegistry {
  private readonly executors = new Map<string, SkillExecutor>();

  register(executor: SkillExecutor): void {
    if (!executor.id.trim()) throw new Error('skill executor id is required');
    this.executors.set(executor.id, executor);
  }

  has(id: string): boolean {
    return this.executors.has(id);
  }

  async run(id: string, input: unknown): Promise<unknown> {
    const executor = this.executors.get(id);
    if (!executor) throw new Error(`skill executor not registered: ${id}`);
    return executor.execute(input);
  }
}
