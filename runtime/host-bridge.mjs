import { execFile } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { homedir, platform as currentPlatform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  formatPackageCoordinate,
  normalizeReleaseChannel,
  parsePackageCoordinate,
} from '../packages/protocol-core/index.mjs';

const exec = promisify(execFile);
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;

function commandTimeout(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : DEFAULT_COMMAND_TIMEOUT_MS;
}

/**
 * Canonical deep link. Registry selection is intentionally not accepted from
 * remote links: the local runtime owns the configured Registry V4 authority.
 */
export function buildInstallUri(coordinate, options = {}) {
  const request = parsePackageCoordinate(coordinate, { channel: options.channel || 'stable' });
  const url = new URL('dsh://package/install');
  url.searchParams.set('spec', formatPackageCoordinate(request));
  url.searchParams.set('channel', request.channel);
  return url.toString();
}

export function parseDshUri(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('dsh URI is required');
  let url;
  try { url = new URL(raw); } catch { throw new Error('invalid dsh URI'); }
  if (url.protocol !== 'dsh:') throw new Error(`unsupported protocol: ${url.protocol}`);
  if (url.hostname !== 'package' || url.pathname !== '/install') {
    throw new Error('unsupported dsh URI; only dsh://package/install is accepted');
  }
  if (url.username || url.password || url.hash) throw new Error('dsh URI must not contain credentials or fragments');
  if (url.searchParams.has('registry') || url.searchParams.has('plugin') || url.searchParams.has('id') || url.searchParams.has('type') || url.searchParams.has('version')) {
    throw new Error('legacy or remote Registry selectors are not accepted in dsh URI');
  }
  const allowedParams = new Set(['spec', 'channel']);
  for (const key of url.searchParams.keys()) if (!allowedParams.has(key)) throw new Error(`unsupported dsh URI parameter: ${key}`);
  const spec = url.searchParams.get('spec');
  if (!spec) throw new Error('dsh package URI requires spec');
  const channel = normalizeReleaseChannel(url.searchParams.get('channel') || 'stable');
  const request = parsePackageCoordinate(spec, { channel });
  return {
    protocol: 'dsh',
    version: 2,
    action: 'install',
    request,
    coordinate: formatPackageCoordinate(request),
  };
}

export function runtimeArgsForRequest(request, options = {}) {
  if (!request || request.protocol !== 'dsh' || request.version !== 2 || request.action !== 'install') throw new Error('unsupported host bridge request');
  const parsed = parsePackageCoordinate(request.coordinate || formatPackageCoordinate(request.request), { channel: request.request?.channel || 'stable' });
  const args = ['package', 'install', formatPackageCoordinate(parsed), '--channel', parsed.channel];
  if (options.approved === true) args.push('--yes');
  if (options.dryRun === true) args.push('--dry-run');
  return args;
}

function shellQuote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}
function shellSingleQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}
function psQuote(value) {
  return String(value).replaceAll("'", "''");
}

export function protocolRegistration(options = {}) {
  const platform = options.platform || currentPlatform();
  const executable = resolve(options.executable || process.execPath);
  const scriptPath = resolve(options.scriptPath || process.argv[1] || 'bin/dsh.mjs');
  const handler = `${shellQuote(executable)} ${shellQuote(scriptPath)} package install-link`;

  if (platform === 'win32') {
    const root = 'HKCU\\Software\\Classes\\dsh';
    const wrapperFile = resolve(options.wrapperFile || join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'DSH', 'url-handler.ps1'));
    const wrapperContent = [
      'param([Parameter(Mandatory=$true)][string]$Url)',
      'Add-Type -AssemblyName PresentationFramework',
      '$result = [System.Windows.MessageBox]::Show("DSH Marketplace requests a local package installation.\\n\\n$Url", "DSH Package Install", "YesNo", "Warning")',
      'if ($result -ne "Yes") { exit 2 }',
      `& '${psQuote(executable)}' '${psQuote(scriptPath)}' package install-link $Url --yes`,
      'exit $LASTEXITCODE',
      '',
    ].join('\n');
    const command = `"powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "${wrapperFile}" "%1"`;
    return {
      platform,
      supported: true,
      handler,
      wrapper_file: wrapperFile,
      wrapper_content: wrapperContent,
      commands: [
        ['reg.exe', ['ADD', root, '/ve', '/d', 'URL:DSH Package Protocol', '/f']],
        ['reg.exe', ['ADD', root, '/v', 'URL Protocol', '/d', '', '/f']],
        ['reg.exe', ['ADD', `${root}\\shell\\open\\command`, '/ve', '/d', command, '/f']],
      ],
    };
  }

  if (platform === 'linux') {
    const desktopFile = resolve(options.desktopFile || join(homedir(), '.local', 'share', 'applications', 'dsh-go.desktop'));
    const wrapperFile = resolve(options.wrapperFile || join(homedir(), '.local', 'share', 'dsh-go', 'url-handler.sh'));
    const wrapperContent = [
      '#!/bin/sh',
      'printf "DSH Marketplace requests a local package installation. Continue? [y/N] "',
      'IFS= read -r answer',
      'case "$answer" in',
      `  y|Y|yes|YES) exec ${shellSingleQuote(executable)} ${shellSingleQuote(scriptPath)} package install-link "$1" --yes ;;`,
      '  *) exit 2 ;;',
      'esac',
      '',
    ].join('\n');
    const content = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=DSH Package Protocol',
      `Exec=${shellQuote(wrapperFile)} %u`,
      `X-DSH-Command=${handler} %u`,
      'Terminal=true',
      'NoDisplay=true',
      'MimeType=x-scheme-handler/dsh;',
      '',
    ].join('\n');
    return {
      platform,
      supported: true,
      handler,
      wrapper_file: wrapperFile,
      wrapper_content: wrapperContent,
      desktop_file: desktopFile,
      desktop_content: content,
      commands: [['xdg-mime', ['default', 'dsh-go.desktop', 'x-scheme-handler/dsh']]],
    };
  }

  if (platform === 'darwin') {
    return {
      platform,
      supported: false,
      requires_client_bundle: true,
      handler,
      info_plist: {
        CFBundleURLTypes: [{ CFBundleURLName: 'DSH Package Protocol', CFBundleURLSchemes: ['dsh'] }],
      },
      message: 'macOS requires the desktop bundle to declare the dsh URL scheme, obtain local approval, and invoke `dsh package install-link <url> --yes`.',
    };
  }

  return { platform, supported: false, handler, message: `automatic dsh protocol registration is not supported on ${platform}` };
}

export async function registerProtocolHandler(options = {}) {
  const registration = protocolRegistration(options);
  if (!registration.supported) return { ...registration, registered: false };
  if (registration.wrapper_file) {
    await mkdir(dirname(registration.wrapper_file), { recursive: true });
    await writeFile(registration.wrapper_file, registration.wrapper_content, 'utf8');
    if (registration.platform === 'linux') await chmod(registration.wrapper_file, 0o755);
  }
  if (registration.platform === 'linux') {
    await mkdir(dirname(registration.desktop_file), { recursive: true });
    await writeFile(registration.desktop_file, registration.desktop_content, 'utf8');
  }
  const warnings = [];
  for (const [command, args] of registration.commands || []) {
    try {
      await exec(command, args, { windowsHide: true, timeout: commandTimeout(options.commandTimeoutMs), killSignal: 'SIGTERM' });
    } catch (error) {
      if (registration.platform === 'win32') throw error;
      warnings.push(`${command}: ${error.message}`);
    }
  }
  return { ...registration, registered: true, ...(warnings.length ? { warnings } : {}) };
}
