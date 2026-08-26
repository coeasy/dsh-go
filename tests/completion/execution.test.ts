import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { invokeMcp, invokeSkill } from '../../runtime/execution.mjs';
import { writeRuntimeRegistry } from '../../runtime/registry.mjs';

let previousHome: string | undefined;
let previousRegistry: string | undefined;
let root: string;
let registryFile: string;

beforeEach(async () => {
  previousHome = process.env.DSH_RUNTIME_HOME;
  previousRegistry = process.env.DSH_REGISTRY;
  root = await mkdtemp(join(tmpdir(), 'dsh-completion-execution-'));
  registryFile = join(root, 'runtime.json');
  process.env.DSH_RUNTIME_HOME = root;
  process.env.DSH_REGISTRY = registryFile;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.DSH_RUNTIME_HOME; else process.env.DSH_RUNTIME_HOME = previousHome;
  if (previousRegistry === undefined) delete process.env.DSH_REGISTRY; else process.env.DSH_REGISTRY = previousRegistry;
});

function activeRecord(type: string, id: string, path: string, binding: any, permissions: string[]) {
  return {
    type, id, version: '0.1.0', state: 'active', channel: 'stable', enabled: true, activated: true,
    restart_required: false, path, permissions, binding: { ...binding, declared_permissions: permissions, permission_policy: null },
  };
}

describe('runtime execution plane', () => {
  it('invokes an active stdio MCP tool through JSON-RPC', async () => {
    const packageDir = join(root, 'mcp-package');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(packageDir, { recursive: true }));
    const server = join(packageDir, 'server.mjs');
    await writeFile(server, `
      import { createInterface } from 'node:readline';
      const lines = createInterface({ input: process.stdin });
      lines.on('line', (line) => {
        const msg = JSON.parse(line);
        if (msg.id === 1) console.log(JSON.stringify({ jsonrpc:'2.0', id:1, result:{ protocolVersion:'2025-03-26', capabilities:{ tools:{} }, serverInfo:{ name:'fixture', version:'0.1.0' } } }));
        if (msg.id === 2) console.log(JSON.stringify({ jsonrpc:'2.0', id:2, result:{ content:[{ type:'text', text: JSON.stringify({ tool:msg.params.name, value:msg.params.arguments.value }) }] } }));
      });
    `);
    await writeRuntimeRegistry({ schema_version: 3, generation: 0, packages: [
      activeRecord('mcp', 'fixture', packageDir, {
        target: packageDir, transport: 'local', kind: 'mcp',
        manifest: { mcp: { transport: 'stdio', command: process.execPath, args: [server] } },
      }, ['process.spawn']),
    ] }, registryFile);

    const result = await invokeMcp('fixture', 'echo', { value: 7 }, { timeoutMs: 5000 });
    expect(result.type).toBe('mcp');
    expect(result.result.content[0].text).toContain('"tool":"echo"');
    expect(result.result.content[0].text).toContain('"value":7');
  });

  it('invokes an active skill executor and fails closed without process permission', async () => {
    const packageDir = join(root, 'skill-package');
    await import('node:fs/promises').then(({ mkdir }) => mkdir(packageDir, { recursive: true }));
    const entrypoint = join(packageDir, 'index.mjs');
    await writeFile(entrypoint, `
      let data='';
      process.stdin.on('data', chunk => data += chunk);
      process.stdin.on('end', () => {
        const input = JSON.parse(data || '{}');
        console.log(JSON.stringify({ doubled: Number(input.value || 0) * 2 }));
      });
    `);
    await writeRuntimeRegistry({ schema_version: 3, generation: 0, packages: [
      activeRecord('skill', 'allowed', packageDir, {
        target: packageDir, transport: 'local', kind: 'skill', entrypoint: 'index.mjs', executor: 'node',
        manifest: { skill: { executor: 'node', entrypoint: 'index.mjs' } },
      }, ['process.spawn']),
      activeRecord('skill', 'blocked', packageDir, {
        target: packageDir, transport: 'local', kind: 'skill', entrypoint: 'index.mjs', executor: 'node',
        manifest: { skill: { executor: 'node', entrypoint: 'index.mjs' } },
      }, []),
    ] }, registryFile);

    const allowed = await invokeSkill('allowed', { value: 6 }, { timeoutMs: 5000 });
    expect(allowed.output).toEqual({ doubled: 12 });
    await expect(invokeSkill('blocked', { value: 1 }, { timeoutMs: 5000 })).rejects.toMatchObject({ code: 'DSH_PERMISSION_NOT_DECLARED' });
  });
});
