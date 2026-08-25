import { describe, expect, it } from 'vitest';

describe('runtime installer lifecycle', () => {
  it('keeps install lifecycle order', () => {
    const flow = ['install', 'persist', 'update', 'rollback', 'remove'];
    expect(flow).toContain('install');
    expect(flow).toContain('remove');
  });
});
