import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildInstallUri, parseDshUri, runtimeArgsForRequest } from '../../runtime/host-bridge.mjs';
import {
  RUNTIME_STATE_SCHEMA_VERSION,
  getRuntimePackage,
  readRuntimeRegistry,
  updateRuntimeRegistry,
  upsertRuntimePackage,
  writeRuntimeRegistry,
} from '../../runtime/registry.mjs';
import { createRuntimePackageRecord } from '../../runtime/lifecycle.mjs';

const dirs: string[] = [];
afterEach(async () => { await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

async function tempState() {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-state-v4-'));
  dirs.push(dir);
  return join(dir, 'runtime-v4.json');
}

describe('Runtime State V4', () => {
  it('starts packages-only and rejects legacy state instead of migrating it', async () => {
    const file = await tempState();
    const empty = await readRuntimeRegistry(file);
    expect(empty).toEqual(expect.objectContaining({ schema_version: 4, generation: 0, packages: [] }));
    expect(RUNTIME_STATE_SCHEMA_VERSION).toBe(4);

    await writeFile(file, JSON.stringify({ schema_version: 3, packages: [], plugins: [] }));
    await expect(readRuntimeRegistry(file)).rejects.toMatchObject({ code: 'DSH_STATE_SCHEMA_UNSUPPORTED' });
  });

  it('uses generation CAS and package identity (type,id)', async () => {
    const file = await tempState();
    const first = await writeRuntimeRegistry({ schema_version: 4, generation: 0, packages: [] }, file);
    expect(first.generation).toBe(1);
    const skill = createRuntimePackageRecord('skill', 'owner/example', '1.0.0', { state: 'pending-restart', restart_required: true });
    const second = await updateRuntimeRegistry((state: any) => upsertRuntimePackage(state, skill), file);
    expect(second.generation).toBe(2);
    expect(getRuntimePackage(second, 'skill', 'owner/example')).toMatchObject({ type: 'skill', id: 'owner/example', version: '1.0.0' });
    await expect(writeRuntimeRegistry(first, file)).rejects.toMatchObject({ code: 'DSH_TRANSACTION_CONFLICT' });
  });

  it('never persists a plugins compatibility mirror', async () => {
    const file = await tempState();
    await writeRuntimeRegistry({ schema_version: 4, generation: 0, packages: [] }, file);
    const stored = JSON.parse(await readFile(file, 'utf8'));
    expect(stored).not.toHaveProperty('plugins');
    await expect(writeRuntimeRegistry({ schema_version: 4, generation: stored.generation, packages: [], plugins: [] } as any, file)).rejects.toThrow(/legacy plugins mirror/i);
  });
});

describe('Package Deep Link V2', () => {
  it('round-trips only canonical package/install links', () => {
    const uri = buildInstallUri('skill:Owner/Example@^1.2.0', { channel: 'beta' });
    expect(uri).toContain('dsh://package/install?');
    const request = parseDshUri(uri);
    expect(request).toMatchObject({ protocol: 'dsh', version: 2, action: 'install', coordinate: 'skill:owner/example@^1.2.0' });
    expect(request.request.channel).toBe('beta');
    expect(runtimeArgsForRequest(request, { approved: true })).toEqual(['package', 'install', 'skill:owner/example@^1.2.0', '--channel', 'beta', '--yes']);
  });

  it('rejects old URLs, Registry injection and unknown parameters', () => {
    expect(() => parseDshUri('dsh://install?id=owner/example')).toThrow(/only dsh:\/\/package\/install/i);
    expect(() => parseDshUri('dsh://plugin/install/owner/example')).toThrow();
    expect(() => parseDshUri('dsh://package/install?spec=plugin%3Aowner%2Fexample%40*&registry=https%3A%2F%2Fevil.example')).toThrow(/Registry selectors/i);
    expect(() => parseDshUri('dsh://package/install?spec=plugin%3Aowner%2Fexample%40*&foo=bar')).toThrow(/unsupported.*parameter/i);
  });
});
