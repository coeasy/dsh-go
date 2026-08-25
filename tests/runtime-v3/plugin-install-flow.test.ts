import { describe, expect, it } from 'vitest';
import { removePlugin } from '../../runtime/v3/installer/remove';

describe('plugin lifecycle flow', () => {
  it('supports remove lifecycle entry', () => {
    const result = removePlugin('demo-plugin');
    expect(result.removed).toBe(true);
  });
});
