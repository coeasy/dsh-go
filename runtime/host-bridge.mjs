import { execFile } from 'node:child_process';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import { homedir, platform as currentPlatform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { assertPackageType, parsePackageSpec } from './package-model.mjs';

const exec = promisify(execFile);
const SPEC_PATTERN = /^(?:github:)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?(?:@[A-Za-z0-9*.^~+_-]+)?$/;
const CHANNEL_PATTERN = /^[A-Za-z0-9._-]+$/;

function safeBridgeSpec(value, fallbackType = 'plugin') {
  let spec = String(value || '').trim();
  const fallback = assertPackageType(fallbackType);
  if (!spec || spec.length > 512) {
    const label = fallback === 'plugin' ? 'plugin' : 'runtime package';
    throw new Error(`invalid ${label} spec in dsh URI: ${spec || '<empty>'}`);
  }
  let type = fallback;
  const colon = spec.indexOf(':');
  if (colon > 0) {
    const prefix = spec.slice(0, colon).toLowerCase();
    if (['plugin', 'mcp', 'skill', 'agent'].includes(prefix)) {
      type = assertPackageType(prefix);
      spec = spec.slice(colon + 1);
    }
  }
  if (!SPEC_PATTERN.test(spec)) {
    const label = type === 'plugin' ? 'plugin' : 'runtime package';
    throw new Error(`invalid ${label} spec in dsh URI: ${spec}`);
  }
  parsePackageSpec(`${type}:${spec}`, '*', type);
  return { type, spec };
}

function safeChannel(value) {
  if (!value) return null;
  const channel = String(value).trim();
  if (!channel || channel.length > 64 || !CHANNEL_PATTERN.test(channel)) {
    throw new Error(`invalid release channel in dsh URI: ${channel || '<empty>'}`);
  }
  return channel;
}

function safeRegistry(value) {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw || raw.length > 2048) throw new Error('invalid registry URL in dsh URI');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('invalid registry URL in dsh URI');
  }
  const localHttp = url.protocol === 'http:' && ['localhost', '127.0.0.1', '::1'].includes(url.hostname.toLowerCase());
  if ((url.protocol !== 'https:' && !localHttp) || url.username || url.password || url.hash) {
    throw new Error('registry URL in dsh URI must use HTTPS (or localhost HTTP) without credentials or fragments');
  }
  return url.toString();
}

export function buildInstallUri(spec, options = {}) {
  const parsed = safeBridgeSpec(spec, options.type || 'plugin');
  const type = options.type ? assertPackageType(options.type) : parsed.type;
  if (type !== parsed.type) throw new Error(`runtime package type mismatch in dsh URI: ${type} != ${parsed.type}`);
  const encoded = encodeURIComponent(parsed.spec);
  const url = type === 'plugin'
    ? new URL(`dsh://plugin/install/${encoded}`)
    : new URL(`dsh://package/install/${type}/${encoded}`);
  const channel = safeChannel(options.channel);
  if (channel) url.searchParams.set('channel', channel);
  const registry = safeRegistry(options.registry);
  if (registry) url.searchParams.set('registry', registry);
  return url.toString();
}

export function parseDshUri(raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('dsh URI is required');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('invalid dsh URI');
  }
  if (url.protocol !== 'dsh:') throw new Error(`unsupported protocol: ${url.protocol}`);

  const channel = safeChannel(url.searchParams.get('channel'));
  const registry = safeRegistry(url.searchParams.get('registry'));
  const registryField = registry ? { registry } : {};
  if (url.hostname === 'install') {
    const marketplaceId = url.searchParams.get('id');
    if (marketplaceId) {
      const type = assertPackageType(url.searchParams.get('type') || 'plugin');
      const version = url.searchParams.get('version') || '*';
      const parsed = safeBridgeSpec(`${marketplaceId}@${version}`, type);
      if (parsed.type !== type) throw new Error(`runtime package type mismatch in dsh URI: ${type} != ${parsed.type}`);
      return {
        protocol: 'dsh',
        kind: type,
        type,
        action: 'install',
        spec: parsed.spec,
        channel,
        ...registryField,
        legacy: false,
        marketplace_v2: true,
      };
    }
    const parsed = safeBridgeSpec(url.searchParams.get('plugin') || url.searchParams.get('spec'), 'plugin');
    if (parsed.type !== 'plugin') throw new Error('legacy dsh install URI only supports plugins');
    return { protocol: 'dsh', kind: 'plugin', action: 'install', spec: parsed.spec, channel, ...registryField, legacy: true };
  }

  if (url.hostname === 'plugin') {
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 2 || segments[0] !== 'install') {
      throw new Error(`unsupported dsh plugin action: ${url.pathname || '/'}`);
    }
    const parsed = safeBridgeSpec(decodeURIComponent(segments[1]), 'plugin');
    if (parsed.type !== 'plugin') throw new Error('plugin URI cannot install another package type');
    return { protocol: 'dsh', kind: 'plugin', action: 'install', spec: parsed.spec, channel, ...registryField, legacy: false };
  }

  if (url.hostname === 'package') {
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 3 || segments[0] !== 'install') {
      throw new Error(`unsupported dsh package action: ${url.pathname || '/'}`);
    }
    const type = assertPackageType(segments[1]);
    const parsed = safeBridgeSpec(decodeURIComponent(segments[2]), type);
    if (parsed.type !== type) throw new Error(`package URI type mismatch: ${type} != ${parsed.type}`);
    return { protocol: 'dsh', kind: type, type, action: 'install', spec: parsed.spec, channel, ...registryField, legacy: false };
  }

  if (['mcp', 'skill', 'agent'].includes(url.hostname)) {
    const type = assertPackageType(url.hostname);
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 2 || segments[0] !== 'install') {
      throw new Error(`unsupported dsh ${type} action: ${url.pathname || '/'}`);
    }
    const parsed = safeBridgeSpec(decodeURIComponent(segments[1]), type);
    return { protocol: 'dsh', kind: type, type, action: 'install', spec: parsed.spec, channel, ...registryField, legacy: false };
  }

  throw new Error(`unsupported dsh URI host: ${url.hostname || '<empty>'}`);
}

export function runtimeArgsForRequest(request) {
  if (!request || !['plugin', 'mcp', 'skill', 'agent'].includes(request.kind) || request.action !== 'install') {
    throw new Error('unsupported host bridge request');
  }
  const parsed = safeBridgeSpec(request.spec, request.kind);
  if (parsed.type !== request.kind) throw new Error('host bridge package type mismatch');
  const args = request.kind === 'plugin'
    ? ['install', parsed.spec]
    : [request.kind, 'install', parsed.spec];
  const channel = safeChannel(request.channel);
  if (channel) args.push('--channel', channel);
  const registry = safeRegistry(request.registry);
  if (registry) args.push('--registry', registry);
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
  const handler = `${shellQuote(executable)} ${shellQuote(scriptPath)} host handle`;

  if (platform === 'win32') {
    const root = 'HKCU\\Software\\Classes\\dsh';
    const wrapperFile = resolve(options.wrapperFile || join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'DSH', 'url-handler.ps1'));
    const wrapperContent = [
      'param([Parameter(Mandatory=$true)][string]$Url)',
      'Add-Type -AssemblyName PresentationFramework',
      '$result = [System.Windows.MessageBox]::Show("DSH Marketplace requests a local package change.\\n\\n$Url", "DSH Install Request", "YesNo", "Warning")',
      'if ($result -ne "Yes") { exit 2 }',
      `& '${psQuote(executable)}' '${psQuote(scriptPath)}' host handle $Url --yes`,
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
        ['reg.exe', ['ADD', root, '/ve', '/d', 'URL:DSH Go Protocol', '/f']],
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
      'printf "DSH Marketplace requests a local package change. Continue? [y/N] "',
      'IFS= read -r answer',
      'case "$answer" in',
      `  y|Y|yes|YES) exec ${shellSingleQuote(executable)} ${shellSingleQuote(scriptPath)} host handle "$1" --yes ;;`,
      '  *) exit 2 ;;',
      'esac',
      '',
    ].join('\n');
    const content = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=DSH Go Host Bridge',
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
        CFBundleURLTypes: [{
          CFBundleURLName: 'DSH Go Protocol',
          CFBundleURLSchemes: ['dsh'],
        }],
      },
      message: 'macOS requires the desktop client bundle to declare the dsh URL scheme in Info.plist, obtain local approval, and forward the URL to `dsh host handle <url> --yes`.',
    };
  }

  return {
    platform,
    supported: false,
    handler,
    message: `automatic dsh protocol registration is not supported on ${platform}`,
  };
}

export async function registerProtocolHandler(options = {}) {
  const registration = protocolRegistration(options);
  if (!registration.supported) return { ...registration, registered: false };

  if (registration.wrapper_file) {
    await mkdir(dirname(registration.wrapper_file), { recursive: true });
    await writeFile(registration.wrapper_file, registration.wrapper_content, 'utf8');
    if (registration.platform === 'linux') await chmod(registration.wrapper_file, 0o755);
  }

  if (registration.platform === 'win32') {
    for (const [command, args] of registration.commands) await exec(command, args, { windowsHide: true });
    return { ...registration, registered: true };
  }

  if (registration.platform === 'linux') {
    await mkdir(dirname(registration.desktop_file), { recursive: true });
    await writeFile(registration.desktop_file, registration.desktop_content, 'utf8');
    const warnings = [];
    for (const [command, args] of registration.commands) {
      try {
        await exec(command, args, { windowsHide: true });
      } catch (error) {
        warnings.push(`${command}: ${error.message}`);
      }
    }
    return { ...registration, registered: true, warnings };
  }

  return { ...registration, registered: false };
}
