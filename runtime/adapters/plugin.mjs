import { createRuntimeAdapter } from './base.mjs';

export const pluginRuntimeAdapter = createRuntimeAdapter('plugin', {
  validate(context) {
    const runtimeType = String(context.lock?.runtime?.type || 'plugin').toLowerCase();
    if (runtimeType !== 'plugin') throw new Error(`plugin runtime type mismatch: ${runtimeType}`);
  },
});
