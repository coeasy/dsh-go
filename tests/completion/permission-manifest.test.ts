import { describe, expect, it } from 'vitest';
import { compilePermissionManifest } from '../../runtime/permission-manifest.mjs';
import { normalizePackageManifest, validatePackageManifest } from '../../runtime/package-manifest.mjs';
import { evaluateResourcePolicy } from '../../runtime/permission-policy.mjs';

describe('structured permission manifest', () => {
  it('preserves legacy flat permission arrays without inventing scoped policy', () => {
    expect(compilePermissionManifest(['process.spawn', 'network'])).toMatchObject({
      permissions: ['network', 'process.spawn'],
      permission_policy: {},
      permission_manifest: null,
      structured: false,
      unknown: [],
    });
  });

  it('compiles structured resources into existing runtime permissions and scoped policies', () => {
    const compiled = compilePermissionManifest({
      filesystem: {
        read: { allow: ['workspace/**'], deny: ['workspace/.git/**'] },
        write: ['workspace/output/**'],
      },
      network: { allow: ['api.github.com'], deny: ['*.internal'] },
      process: { spawn: { allow: ['node', 'python*'] } },
      secrets: { access: ['github_token'] },
      mcp: { tools: ['github.*'] },
      shell: false,
    });

    expect(compiled.permissions).toEqual([
      'filesystem.read',
      'filesystem.write',
      'mcp.tools',
      'network',
      'process.spawn',
      'secrets.read',
    ]);
    expect(compiled.permission_policy).toMatchObject({
      'filesystem.read': { allow: ['workspace/**'], deny: ['workspace/.git/**'] },
      'filesystem.write': { allow: ['workspace/output/**'], deny: [] },
      network: { allow: ['api.github.com'], deny: ['*.internal'] },
      'process.spawn': { allow: ['node', 'python*'], deny: [] },
      'secrets.read': { allow: ['github_token'], deny: [] },
      'mcp.tools': { allow: ['github.*'], deny: [] },
    });
    expect(evaluateResourcePolicy(compiled.permission_policy, 'network', 'api.github.com').allowed).toBe(true);
    expect(evaluateResourcePolicy(compiled.permission_policy, 'network', 'db.internal').allowed).toBe(false);
  });

  it('represents unrestricted network access explicitly as the high-risk permission', () => {
    const compiled = compilePermissionManifest({ network: { unrestricted: true } });
    expect(compiled.permissions).toEqual(['network.unrestricted']);
    expect(compiled.permission_policy).toEqual({});
  });

  it('lets an explicit permission_policy override a generated scope for backward compatibility', () => {
    const compiled = compilePermissionManifest(
      { network: { allow: ['api.github.com'] } },
      { network: { allow: ['api.github.com', 'objects.githubusercontent.com'], deny: [] } },
    );
    expect(compiled.permission_policy.network).toEqual({
      allow: ['api.github.com', 'objects.githubusercontent.com'],
      deny: [],
    });
  });

  it('normalizes a valid structured MCP manifest into the current enforcement contract', () => {
    const data = {
      manifest_version: '1.0.0',
      id: 'github-mcp',
      name: 'GitHub MCP',
      version: '0.1.0',
      type: 'mcp',
      permissions: {
        network: { allow: ['api.github.com'] },
        process: { spawn: ['node'] },
        secrets: { access: ['github_token'] },
      },
      mcp: { transport: 'stdio', command: 'node', args: ['server.mjs'] },
    };

    const result = validatePackageManifest(data, { file: 'dsh-package.json' });
    expect(result.valid).toBe(true);
    expect(result.manifest).toMatchObject({
      permissions: ['network', 'process.spawn', 'secrets.read'],
      permission_policy: {
        network: { allow: ['api.github.com'], deny: [] },
        'process.spawn': { allow: ['node'], deny: [] },
        'secrets.read': { allow: ['github_token'], deny: [] },
      },
      permission_manifest: {
        network: { unrestricted: false, allow: ['api.github.com'], deny: [] },
        secrets: { access: ['github_token'] },
      },
    });
  });

  it('still rejects unknown explicit policy keys instead of dropping them silently', () => {
    const data = {
      manifest_version: '1.0.0',
      id: 'bad-policy',
      name: 'Bad Policy',
      version: '0.1.0',
      type: 'plugin',
      permissions: { filesystem: { read: ['workspace/**'] } },
      permission_policy: { 'kernel.admin': { allow: ['*'] } },
      plugin: { entrypoint: 'index.mjs' },
    };
    expect(validatePackageManifest(data, { file: 'dsh-package.json' })).toMatchObject({
      valid: false,
      errors: ['permission_policy contains unknown permission: kernel.admin'],
    });
  });

  it('exposes the compiled permission manifest through normalization without changing legacy manifests', () => {
    expect(normalizePackageManifest({
      manifest_version: '1.0.0', id: 'legacy', name: 'Legacy', version: '0.1.0', type: 'plugin',
      permissions: ['filesystem.read'], plugin: { entrypoint: 'index.mjs' },
    })?.permission_manifest).toBeUndefined();
  });
});
