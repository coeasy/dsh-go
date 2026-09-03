import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { homedir, platform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { parsePackageRequest } from './package-model.mjs';

const exec = promisify(execFile);
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

function commandTimeout(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : DEFAULT_COMMAND_TIMEOUT_MS;
}

function normalizedInstallRequest(request = {}) {
  const type = request.type || 'plugin';
  const version = request.versionRange || request.version || '*';
  return parsePackageRequest(`${type}:${request.id}@${version}`, {
    defaultType: type,
    defaultVersion: '*',
    channel: request.channel || 'stable',
    registry: request.registry || null,
  });
}

export function buildInstallDeepLink(request) {
  const parsed = normalizedInstallRequest(request);
  const url = new URL('dsh://install');
  url.searchParams.set('id', parsed.id);
  url.searchParams.set('version', parsed.versionRange);
  url.searchParams.set('channel', parsed.channel);
  url.searchParams.set('type', parsed.type);
  if (parsed.registry) url.searchParams.set('registry', parsed.registry);
  return url.toString();
}

export function parseDshUrl(input) {
  let url;
  try { url = new URL(String(input || '')); } catch { throw new Error('invalid dsh URL'); }
  if (url.protocol !== 'dsh:') throw new Error('unsupported URL protocol');
  const action = (url.hostname || url.pathname.replace(/^\//, '')).toLowerCase();
  if (!['install', 'update', 'open'].includes(action)) throw new Error(`unsupported dsh action: ${action}`);
  if (action === 'open') {
    return {
      protocol: 'dsh',
      action,
      id: url.searchParams.get('id') || '',
      version: url.searchParams.get('version') || '*',
      versionRange: url.searchParams.get('version') || '*',
      channel: url.searchParams.get('channel') || 'stable',
      type: url.searchParams.get('type') || 'plugin',
      registry: url.searchParams.get('registry') || undefined,
    };
  }
  const id = url.searchParams.get('id') || url.searchParams.get('plugin') || '';
  const type = url.searchParams.get('type') || 'plugin';
  const version = url.searchParams.get('version') || '*';
  const request = parsePackageRequest(`${type}:${id}@${version}`, {
    defaultType: type,
    defaultVersion: '*',
    channel: url.searchParams.get('channel') || 'stable',
    registry: url.searchParams.get('registry') || null,
  });
  return {
    protocol: 'dsh',
    action,
    ...request,
    version: request.versionRange,
    registry: request.registry || undefined,
  };
}

function psQuote(value) {
  return String(value).replace(/'/g, "''");
}

export function protocolRegistrationPlan(options = {}) {
  const os = options.platform || platform();
  const node = options.node || process.execPath;
  const cli = options.cli || fileURLToPath(new URL('./dsh.mjs', import.meta.url));
  if (os === 'win32') {
    const wrapper = resolve(options.wrapperPath || join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'DSH', 'url-handler.ps1'));
    const content = `param([Parameter(Mandatory=$true)][string]$Url)\nAdd-Type -AssemblyName PresentationFramework\n$result = [System.Windows.MessageBox]::Show("DSH Marketplace requests a local package change.\\n\\n$Url", "DSH Install Request", "YesNo", "Warning")\nif ($result -ne "Yes") { exit 2 }\n& '${psQuote(node)}' '${psQuote(cli)}' bridge handle $Url --yes\nexit $LASTEXITCODE\n`;
    const command = `"powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "${wrapper}" "%1"`;
    return {
      platform: os,
      files: [{ path: wrapper, content }],
      commands: [
        ['reg', ['add', 'HKCU\\Software\\Classes\\dsh', '/ve', '/d', 'URL:DSH Protocol', '/f']],
        ['reg', ['add', 'HKCU\\Software\\Classes\\dsh', '/v', 'URL Protocol', '/d', '', '/f']],
        ['reg', ['add', 'HKCU\\Software\\Classes\\dsh\\shell\\open\\command', '/ve', '/d', command, '/f']],
      ],
      wrapper,
    };
  }
  if (os === 'darwin') {
    const app = resolve(options.appPath || join(homedir(), 'Applications', 'DSH URL Handler.app'));
    const plist = join(app, 'Contents', 'Info.plist');
    const script = `on open location theURL\n  display dialog "DSH Marketplace requests a local package change. Continue?" buttons {"Cancel", "Continue"} default button "Continue" cancel button "Cancel"\n  do shell script quoted form of "${node}" & " " & quoted form of "${cli}" & " bridge handle " & quoted form of theURL & " --yes"\nend open location`;
    const plistBuddy = '/usr/libexec/PlistBuddy';
    const lsregister = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
    return {
      platform: os,
      files: [],
      commands: [
        ['rm', ['-rf', app]],
        ['osacompile', ['-o', app, '-e', script]],
        [plistBuddy, ['-c', 'Add :CFBundleURLTypes array', plist]],
        [plistBuddy, ['-c', 'Add :CFBundleURLTypes:0 dict', plist]],
        [plistBuddy, ['-c', 'Add :CFBundleURLTypes:0:CFBundleURLName string com.dsh.protocol', plist]],
        [plistBuddy, ['-c', 'Add :CFBundleURLTypes:0:CFBundleURLSchemes array', plist]],
        [plistBuddy, ['-c', 'Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string dsh', plist]],
        [lsregister, ['-f', app]],
      ],
      app,
      plist,
    };
  }
  const desktop = resolve(options.desktopFile || join(homedir(), '.local', 'share', 'applications', 'dsh-url-handler.desktop'));
  const content = `[Desktop Entry]\nName=DSH URL Handler\nExec=${JSON.stringify(node)} ${JSON.stringify(cli)} bridge handle %u\nType=Application\nNoDisplay=true\nTerminal=true\nMimeType=x-scheme-handler/dsh;\n`;
  return {
    platform: os,
    files: [{ path: desktop, content, mode: 0o755 }],
    commands: [['xdg-mime', ['default', 'dsh-url-handler.desktop', 'x-scheme-handler/dsh']]],
  };
}

export async function registerProtocolHandler(options = {}) {
  const plan = protocolRegistrationPlan(options);
  if (options.dryRun) return { registered: false, dry_run: true, ...plan };
  for (const file of plan.files || []) {
    await mkdir(dirname(file.path), { recursive: true });
    await writeFile(file.path, file.content, 'utf8');
    if (file.mode) await chmod(file.path, file.mode);
  }
  for (const [command, argv] of plan.commands || []) {
    await exec(command, argv, {
      windowsHide: true,
      timeout: commandTimeout(options.commandTimeoutMs),
      killSignal: 'SIGTERM',
    });
  }
  return { registered: true, ...plan };
}

export function deepLinkInstallPlan(input) {
  const request = typeof input === 'string' ? parseDshUrl(input) : { protocol: 'dsh', action: 'install', ...normalizedInstallRequest(input) };
  if (request.action !== 'install' && request.action !== 'update') throw new Error(`dsh action ${request.action} does not create an install plan`);
  const parsed = parsePackageRequest(`${request.type}:${request.id}@${request.versionRange || request.version || '*'}`, {
    defaultType: request.type,
    defaultVersion: '*',
    channel: request.channel || 'stable',
    registry: request.registry || null,
  });
  const argv = [parsed.type, request.action === 'update' ? 'update' : 'install', `${parsed.id}@${parsed.versionRange}`];
  if (parsed.channel !== 'stable') argv.push('--channel', parsed.channel);
  if (parsed.registry) argv.push('--registry', parsed.registry);
  return {
    request: { protocol: 'dsh', action: request.action, ...parsed, version: parsed.versionRange },
    executable: 'dsh',
    argv,
    confirmation_required: true,
    auto_restart: false,
    restart_required_after_success: true,
  };
}
