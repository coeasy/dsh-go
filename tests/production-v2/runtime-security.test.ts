import { describe, expect, it } from 'vitest';
import { evaluateCompatibility } from '../../runtime/compatibility.mjs';
import { inspectPermissions, permissionDiff } from '../../runtime/permissions.mjs';
import { buildInstallDeepLink, deepLinkInstallPlan, parseDshUrl, protocolRegistrationPlan } from '../../runtime/client-bridge.mjs';

const env = { os: 'linux', arch: 'x64', node: '22.0.0', runtime: '3.0.0', client: '2.3.0', capabilities: ['mcp'] };

describe('production runtime preflight', () => {
  it('explains compatible and incompatible environments', () => {
    const ok = evaluateCompatibility({ compatibility: { os: ['linux'], arch: ['x64'], node: '>=20.0.0', runtime: '>=3.0.0', client: '>=2.0.0', capabilities: ['mcp'] } }, env);
    expect(ok.compatible).toBe(true);
    const blocked = evaluateCompatibility({ compatibility: { os: ['darwin'], node: '>=23.0.0' } }, env);
    expect(blocked.compatible).toBe(false);
    expect(blocked.reasons.join(' ')).toContain('not supported');
  });

  it('requires consent for dangerous permissions and calculates upgrades', () => {
    const report = inspectPermissions(['filesystem.read', 'filesystem.write', 'shell']);
    expect(report.requires_consent).toBe(true);
    expect(report.dangerous).toEqual(['filesystem.write', 'shell']);
    expect(permissionDiff(['filesystem.read'], ['filesystem.read', 'network'])).toEqual({ added: ['network'], removed: [], unchanged: ['filesystem.read'] });
  });

  it('round trips secure dsh install links without enabling auto restart', () => {
    const link = buildInstallDeepLink({ id: 'demo', version: '0.1.0', type: 'skill', channel: 'stable' });
    expect(parseDshUrl(link)).toMatchObject({ action: 'install', id: 'demo', type: 'skill' });
    expect(deepLinkInstallPlan(link)).toMatchObject({ confirmation_required: true, auto_restart: false, restart_required_after_success: true });
  });

  it('builds interactive platform-specific protocol registration plans', () => {
    const windows = protocolRegistrationPlan({ platform: 'win32', node: 'node', cli: 'dsh.mjs', wrapperPath: 'C:/DSH/url-handler.ps1' });
    expect(windows.commands[0][0]).toBe('reg');
    expect(windows.files[0].content).toContain('MessageBox');
    expect(windows.files[0].content).toContain('--yes');

    const linux = protocolRegistrationPlan({ platform: 'linux', node: 'node', cli: 'dsh.mjs', desktopFile: '/tmp/dsh.desktop' });
    expect(linux.files[0].content).toContain('x-scheme-handler/dsh');
    expect(linux.files[0].content).toContain('Terminal=true');

    const mac = protocolRegistrationPlan({ platform: 'darwin', node: 'node', cli: 'dsh.mjs', appPath: '/tmp/DSH.app' });
    expect(mac.commands.some(([command]) => command === 'osacompile')).toBe(true);
    expect(mac.commands.some((entry) => {
      const command = entry[0];
      const args = entry[1];
      return String(command).includes('PlistBuddy') && Array.isArray(args) && args.join(' ').includes('CFBundleURLSchemes');
    })).toBe(true);
    expect(mac.commands.some(([command]) => String(command).includes('lsregister'))).toBe(true);
  });
});
