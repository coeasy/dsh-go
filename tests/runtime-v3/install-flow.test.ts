import { describe, expect, it } from 'vitest';

import { InstallLifecycle } from '../../runtime/v3/install/install-lifecycle';

describe('install lifecycle', () => {
  it('tracks installed state', () => {
    const lifecycle = new InstallLifecycle();
    const result = lifecycle.transition('downloaded', 'verified');

    expect(result.state).toBe('verified');
  });
});
