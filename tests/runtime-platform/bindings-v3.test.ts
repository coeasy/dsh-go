import { describe, expect, it } from 'vitest';

const { bindingIsSafe, createRuntimeBinding } = await import('../../runtime/bindings.mjs');

describe('Runtime Platform V3 local bindings', () => {
  it('fails closed on permissions and exposes type-specific binding contracts', () => {
    const base = { id: 'demo', target: '/tmp/demo', lock: { capabilities: [], runtime: {} }, manifest: { file: null, format: null, manifest: null } };
    const mcp = createRuntimeBinding({ ...base, type: 'mcp' });
    expect(mcp.permissions).toEqual({ network: false, filesystem: false, process: false });
    expect(mcp.kind).toBe('mcp');
    expect(bindingIsSafe(mcp)).toBe(true);

    const agent = createRuntimeBinding({ ...base, type: 'agent', lock: { capabilities: ['tool'], runtime: { permissions: { network: true } } } });
    expect(agent.permissions).toEqual({ network: true, filesystem: false, process: false });
    expect(agent.kind).toBe('agent');
  });
});
