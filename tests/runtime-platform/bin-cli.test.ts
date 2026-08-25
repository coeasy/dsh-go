import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const exec = promisify(execFile);
const cli = join(process.cwd(), 'bin', 'dsh.mjs');

async function run(args: string[]) {
  return exec(process.execPath, [cli, ...args], { cwd: process.cwd(), encoding: 'utf8' });
}

describe('Phase 7 dsh executable', () => {
  it('exposes help and version without loading the runtime installer', async () => {
    const help = await run(['--help']);
    expect(help.stdout).toContain('DSH Go CLI');
    expect(help.stdout).toContain('dsh startup activate');
    expect(help.stdout).toContain('never restart the client automatically');

    const version = await run(['--version']);
    expect(version.stdout.trim()).toBe('2.3.0');
  });

  it('parses the legacy marketplace URI and builds the canonical URI', async () => {
    const parsed = await run(['host', 'parse', 'dsh://install?plugin=ruvnet%2Fruflo']);
    const request = JSON.parse(parsed.stdout);
    expect(request.spec).toBe('ruvnet/ruflo');
    expect(request.legacy).toBe(true);

    const uri = await run(['host', 'uri', 'ruvnet/ruflo@0.1.0', '--channel', 'stable']);
    expect(uri.stdout.trim()).toBe('dsh://plugin/install/ruvnet%2Fruflo%400.1.0?channel=stable');
  });

  it('prints a desktop-client registration contract', async () => {
    const result = await run(['host', 'registration']);
    const registration = JSON.parse(result.stdout);
    expect(registration.handler).toContain('host handle');
    expect(typeof registration.platform).toBe('string');
  });
});
