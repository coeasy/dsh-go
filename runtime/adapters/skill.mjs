import { createRuntimeAdapter } from './base.mjs';

export const skillRuntimeAdapter = createRuntimeAdapter('skill', {
  validate(context) {
    const runtimeType = String(context.lock?.runtime?.type || 'skill').toLowerCase();
    if (runtimeType !== 'skill') throw new Error(`skill runtime type mismatch: ${runtimeType}`);
  },
});
