import { discoverPackageManifest, createRuntimeBinding, bindingIsSafe } from '../bindings.mjs';
import { checkRuntimePackageHealth } from '../health.mjs';
import { normalizePackageId, normalizePackageType, packageKey } from '../../packages/protocol-core/index.mjs';

export const RUNTIME_ADAPTER_ABI_VERSION = 1;

export function createRuntimeAdapter(type, hooks = {}) {
  const normalizedType = normalizePackageType(type);
  return Object.freeze({
    abi_version: RUNTIME_ADAPTER_ABI_VERSION,
    type: normalizedType,
    async validate(context) {
      const id = normalizePackageId(context.id);
      if (!context.target) throw new Error(`runtime adapter target is required: ${packageKey(normalizedType, id)}`);
      if (context.lock?.type !== normalizedType || context.lock?.id !== id) throw new Error(`runtime adapter identity mismatch: ${packageKey(normalizedType, id)}`);
      if (hooks.validate) await hooks.validate({ ...context, type: normalizedType, id });
      return { type: normalizedType, id, ok: true };
    },
    async prepare(context) {
      await this.validate(context);
      const manifest = context.manifest || await discoverPackageManifest(context.target, normalizedType);
      if (hooks.prepare) await hooks.prepare({ ...context, type: normalizedType, manifest });
      return { ...context, type: normalizedType, manifest };
    },
    async bind(context) {
      const prepared = context.manifest ? context : await this.prepare(context);
      const binding = createRuntimeBinding({
        type: normalizedType,
        id: prepared.id,
        target: prepared.target,
        lock: prepared.lock,
        manifest: prepared.manifest,
      });
      if (!bindingIsSafe(binding)) throw new Error(`unsafe runtime binding: ${packageKey(normalizedType, prepared.id)}`);
      if (hooks.bind) await hooks.bind({ ...prepared, binding });
      return binding;
    },
    async activate(context) {
      if (hooks.activate) return hooks.activate(context);
      return { active: true, binding: context.binding };
    },
    async health(context) {
      if (hooks.health) return hooks.health(context);
      return checkRuntimePackageHealth(context.record || context, context.options || {});
    },
    async deactivate(context) {
      if (hooks.deactivate) return hooks.deactivate(context);
      return { active: false };
    },
    async cleanup(context) {
      if (hooks.cleanup) return hooks.cleanup(context);
      return { cleaned: true };
    },
  });
}
