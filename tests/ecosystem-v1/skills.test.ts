import { describe, expect, it } from 'vitest';
import { executeSkill } from '../../skills/v1/execution-engine';
import { SkillExecutorRegistry } from '../../skills/v1/executor-registry';
import { SkillResolver } from '../../skills/v1/resolver';
import type { SkillManifest } from '../../skills/v1/types';

const dependency: SkillManifest = { id: 'dep', version: '0.1.0', dependencies: [], executor: 'dep' };
const root: SkillManifest = { id: 'root', version: '0.1.0', dependencies: ['dep'], executor: 'root' };

describe('Ecosystem Platform skills', () => {
  it('resolves dependencies before the root and rejects cycles', () => {
    expect(new SkillResolver([root, dependency]).resolve(root)).toEqual(['dep', 'root']);
    const a: SkillManifest = { id: 'a', version: '0.1.0', dependencies: ['b'], executor: 'a' };
    const b: SkillManifest = { id: 'b', version: '0.1.0', dependencies: ['a'], executor: 'b' };
    expect(() => new SkillResolver([a, b]).resolve(a)).toThrow(/cycle/);
  });

  it('executes only registered executors and reports missing executors', async () => {
    const registry = new SkillExecutorRegistry();
    registry.register({ id: 'root', execute: async (input) => ({ input, ok: true }) });
    const success = await executeSkill({ skillId: 'root', input: 42, registry });
    expect(success.success).toBe(true);
    expect(success.state).toBe('completed');
    const missing = await executeSkill({ skillId: 'missing', input: null, registry });
    expect(missing.success).toBe(false);
    expect(missing.error).toMatch(/not registered/);
  });
});
