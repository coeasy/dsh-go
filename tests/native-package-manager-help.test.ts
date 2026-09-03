import { describe, expect, it } from 'vitest';
import { isHelpRequest, nativePackageManagerHelp } from '../runtime/cli-help.mjs';

describe('native package manager help', () => {
  it('advertises discovery, typed installs and latest-stable semantics', () => {
    const help = nativePackageManagerHelp();
    expect(help).toContain('dsh package search <query>');
    expect(help).toContain('dsh <plugin|mcp|skill|agent> search <query>');
    expect(help).toContain('dsh <plugin|mcp|skill|agent> install <id|owner/repo>[@version]');
    expect(help).toContain('latest compatible package');
    expect(help).toContain('pending until');
    expect(help).not.toContain('dsh plugin add');
  });

  it('recognizes every public help entry form', () => {
    expect(isHelpRequest([])).toBe(true);
    expect(isHelpRequest(['help'])).toBe(true);
    expect(isHelpRequest(['--help'])).toBe(true);
    expect(isHelpRequest(['-h'])).toBe(true);
    expect(isHelpRequest(['plugin', 'search', 'memory'])).toBe(false);
  });
});
