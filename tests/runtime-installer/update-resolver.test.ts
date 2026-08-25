import { describe, expect, it } from 'vitest';
import { resolveDependencies } from '../../runtime/v3/resolver/dependency-resolver';

describe('runtime installer dependency resolver', () => {
  it('resolves dependencies in order', () => {
    expect(resolveDependencies([
      { id: 'app', dependencies: ['tool'] },
      { id: 'tool' },
    ], 'app')).toEqual(['tool', 'app']);
  });
});
