import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditPackageSecurity } from '../../scripts/package-security-audit.mjs';

async function fixture(source: string, permissions: string[] = []) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-audit-'));
  await writeFile(join(root, 'dsh-package.json'), JSON.stringify({
    manifest_version: '1.0.0', id: 'audit-fixture', name: 'Audit Fixture', version: '0.1.0', type: 'skill',
    permissions, skill: { executor: 'node', entrypoint: 'index.js' },
  }));
  await writeFile(join(root, 'index.js'), source);
  return root;
}

describe('package security audit', () => {
  it('does not treat a documentation URL literal as network behavior', async () => {
    const report = await auditPackageSecurity(await fixture('export const docs = "https://example.test/docs";\n'));
    expect(report.safe).toBe(true);
    expect(report.undeclared_permissions).not.toContain('network');
  });

  it('detects real undeclared network calls', async () => {
    const report = await auditPackageSecurity(await fixture('export async function run(){ return fetch("https://example.test/api"); }\n'));
    expect(report.safe).toBe(false);
    expect(report.undeclared_permissions).toContain('network');
  });

  it('accepts a network call when permission is declared', async () => {
    const report = await auditPackageSecurity(await fixture('export async function run(){ return fetch("https://example.test/api"); }\n', ['network']));
    expect(report.safe).toBe(true);
  });
});
