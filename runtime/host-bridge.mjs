import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { homedir, platform as currentPlatform } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const SPEC_PATTERN = /^(?:github:)?[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)?(?:@[A-Za-z0-9*.^~+_-]+)?$/;
const CHANNEL_PATTERN = /^[A-Za-z0-9._-]+$/;

function safeSpec(value) {
  const spec = String(value || '').trim();
  if (!spec || spec.length > 512 || !SPEC_PATTERN.test(spec)) {
    throw new Error(`invalid plugin spec in dsh URI: ${spec || '<empty>'}`);
  }
  return spec;
}

function safeChannel(value) {
  if (!value) return null;
  const channel = String(value).trim();
  if (!channel || channel.length > 64 || !CHANNEL_PATTERN.test(channel)) {
    throw new Error(`invalid release channel in dsh URI: ${channel || '<empty>'}`);
  }
  return channel;
}

export function buildInstallUri(spec, options = {}) {
  const encoded = encodeURIComponent(safeSpec(spec));
  const url = new URL(`dsh://plugin/install/${encoded}`);
  const channel = safeChannel(options.channel);
  if (channel) url.searchParams.set('channel', channel);
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
  if (url.hostname === 'install') {
    const spec = safeSpec(url.searchParams.get('plugin') || url.searchParams.get('spec'));
    return { protocol: 'dsh', kind: 'plugin', action: 'install', spec, channel, legacy: true };
  }

  if (url.hostname === 'plugin') {
    const segments = url.pathname.split('/').filter(Boolean);
    if (segments.length !== 2 || segments[0] !== 'install') {
      throw new Error(`unsupported dsh plugin action: ${url.pathname || '/'}`);
    }
    const spec = safeSpec(decodeURIComponent(segments[1]));
    return { protocol: 'dsh', kind: 'plugin', action: 'install', spec, channel, legacy: false };
  }

  throw new Error(`unsupported dsh URI host: ${url.hostname || '<empty>'}`);
}

export function runtimeArgsForRequest(request) {
  if (!request || request.kind !== 'plugin' || request.action !== 'install') {
    throw new Error('unsupported host bridge request');
  }
  const args = ['install', safeSpec(request.spec)];
  const channel = safeChannel(request.channel);
  if (channel) args.push('--channel', channel);
  return args;
}

function shellQuote(value) {
  return `"${String(value).replaceAll('"', '\\"')}"`;
}

export function protocolRegistration(options = {}) {
  const platform = options.platform || currentPlatform();
  const executable = resolve(options.executable || process.execPath);
  const scriptPath = resolve(options.scriptPath || process.argv[1] || 'bin/dsh.mjs');
  const handler = `${shellQuote(executable)} ${shellQuote(scriptPath)} host handle`;

  if (platform === 'win32') {
    const root = 'HKCU\\Software\\Classes\\dsh';
    return {
      platform,
      supported: true,
      handler,
      commands: [
        ['reg.exe', ['ADD', root, '/ve', '/d', 'URL:DSH Go Protocol', '/f']],
        ['reg.exe', ['ADD', root, '/v', 'URL Protocol', '/d', '', '/f']],
        ['reg.exe', ['ADD', `${root}\\shell\\open\\command`, '/ve', '/d', `${handler} "%1"`, '/f']],
      ],
    };
  }

  if (platform === 'linux') {
    const desktopFile = resolve(options.desktopFile || join(homedir(), '.local', 'share', 'applications', 'dsh-go.desktop'));
    const content = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=DSH Go Host Bridge',
      `Exec=${handler} %u`,
      'Terminal=false',
      'NoDisplay=true',
      'MimeType=x-scheme-handler/dsh;',
      '',
    ].join('\n');
    return {
      platform,
      supported: true,
      handler,
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
      message: 'macOS requires the desktop client bundle to declare the dsh URL scheme in Info.plist and forward the URL to `dsh host handle`.',
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
