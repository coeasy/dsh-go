import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { formatCliError, formatCliSuccess } from '../runtime/cli-output.mjs';
import { parseGlobalCliOptions } from '../runtime/cli-global-options.mjs';
import { assertI18nCatalogComplete, SUPPORTED_LANGUAGES, translate } from '../runtime/i18n.mjs';
import { canTransition } from '../runtime/lifecycle.mjs';
import { parsePackageRequest } from '../runtime/package-model.mjs';

const exec = promisify(execFile);

describe('CLI machine contract', () => {
  it('keeps a language-independent stable success envelope', () => {
    const payload = formatCliSuccess({ id: 'demo', type: 'plugin', channel: 'stable' }, { command: 'plugin info' });
    expect(payload).toEqual({
      schema_version: 1,
      ok: true,
      command: 'plugin info',
      data: { id: 'demo', type: 'plugin', channel: 'stable' },
    });
  });

  it('keeps stable error codes and structured details', () => {
    const error = Object.assign(new Error('approval required'), {
      code: 'DSH_PERMISSION_CONSENT_REQUIRED',
      permissionReport: { dangerous: ['shell'] },
    });
    expect(formatCliError(error, { command: 'plugin install' })).toEqual({
      schema_version: 1,
      ok: false,
      command: 'plugin install',
      error: {
        code: 'DSH_PERMISSION_CONSENT_REQUIRED',
        message: 'approval required',
        details: { permission_report: { dangerous: ['shell'] } },
      },
    });
  });

  it('accepts global --json and --lang before typed commands', () => {
    expect(parseGlobalCliOptions(['--json', '--lang', 'zh-CN', 'plugin', 'info', 'demo'], {} as NodeJS.ProcessEnv)).toEqual({
      args: ['plugin', 'info', 'demo'],
      json: true,
      language: 'zh-CN',
    });
  });

  it('runs the real CLI with a versioned JSON envelope', async () => {
    const { stdout } = await exec(process.execPath, ['bin/dsh.mjs', '--json', '--version'], {
      cwd: process.cwd(),
      env: { ...process.env, DSH_OUTPUT_JSON: '' },
    });
    const payload = JSON.parse(stdout);
    expect(payload.schema_version).toBe(1);
    expect(payload.ok).toBe(true);
    expect(payload.data.version).toMatch(/^\d+\.\d+\.\d+/);
  });
});

describe('CLI multilingual contract', () => {
  it('requires identical translation keys for every supported language', () => {
    const status = assertI18nCatalogComplete();
    expect(status.ok).toBe(true);
    expect(Object.keys(status.languages).sort()).toEqual([...SUPPORTED_LANGUAGES].sort());
  });

  it('translates human text without translating machine tokens', () => {
    expect(translate('native_package_manager', 'zh-CN')).toContain('包管理');
    const request = parsePackageRequest('mcp:dsh-go-marketplace@latest', { channel: 'stable' });
    expect(request).toMatchObject({
      type: 'mcp',
      id: 'dsh-go-marketplace',
      versionRange: 'latest',
      channel: 'stable',
    });
  });

  it('renders localized real help while preserving CLI subcommands', async () => {
    const { stdout } = await exec(process.execPath, ['bin/dsh.mjs', '--lang', 'zh-CN', '--help'], {
      cwd: process.cwd(),
      env: { ...process.env, DSH_OUTPUT_JSON: '' },
    });
    expect(stdout).toContain('原生包管理器');
    expect(stdout).toContain('dsh package search <query>');
    expect(stdout).toContain('dsh <plugin|mcp|skill|agent> install');
  });
});

describe('pending restart lifecycle contract', () => {
  it('allows installs to persist pending-restart before activation', () => {
    expect(canTransition('installing', 'pending-restart')).toBe(true);
    expect(canTransition('pending-restart', 'verifying')).toBe(true);
    expect(canTransition('pending-restart', 'active')).toBe(false);
  });
});
