import { createRuntimeAdapter } from './base.mjs';

export const mcpRuntimeAdapter = createRuntimeAdapter('mcp', {
  validate(context) {
    const runtimeType = String(context.lock?.runtime?.type || 'mcp').toLowerCase();
    if (runtimeType !== 'mcp') throw new Error(`mcp runtime type mismatch: ${runtimeType}`);
    if (!context.lock?.entrypoints || typeof context.lock.entrypoints !== 'object') throw new Error('mcp package requires explicit entrypoints');
  },
});
