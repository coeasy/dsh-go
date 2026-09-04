import { createRuntimeAdapter } from './base.mjs';

export const agentRuntimeAdapter = createRuntimeAdapter('agent', {
  validate(context) {
    const runtimeType = String(context.lock?.runtime?.type || 'agent').toLowerCase();
    if (runtimeType !== 'agent') throw new Error(`agent runtime type mismatch: ${runtimeType}`);
  },
});
