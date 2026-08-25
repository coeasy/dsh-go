import { describe, expect, it } from 'vitest';

import { RegistryValidator } from '../../registry-v3/validator/registry-validator';

describe('registry validator', () => {
  it('rejects missing plugin id', () => {
    const validator = new RegistryValidator();
    expect(validator.validate({ version: '0.1.0' }).valid).toBe(false);
  });
});
