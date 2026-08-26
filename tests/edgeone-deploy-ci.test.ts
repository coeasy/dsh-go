import { describe, expect, it } from 'vitest';
import {
  classifyFailure,
  parseLastJson,
  sanitizeLog,
  validateCliVersion,
  validateDeployResult,
} from '../scripts/edgeone-deploy-ci.mjs';

describe('EdgeOne CI deployment helpers', () => {
  it('requires a pinned supported CLI version', () => {
    expect(validateCliVersion('1.6.0')).toBe('1.6.0');
    expect(validateCliVersion('1.6.28')).toBe('1.6.28');
    expect(validateCliVersion('2.0.0')).toBe('2.0.0');
    expect(() => validateCliVersion('1.5.9')).toThrow('>= 1.6.0');
    expect(() => validateCliVersion('latest')).toThrow('pinned semver');
  });

  it('sanitizes direct tokens, signed URLs, JSON token fields, and bearer credentials', () => {
    const token = 'edgeone-super-secret';
    const input = [
      `token=${token}`,
      'https://preview.edgeone.app/?eo_token=query-secret',
      '{"apiToken":"json-secret"}',
      'Authorization: Bearer bearer-secret',
    ].join('\n');
    const safe = sanitizeLog(input, token);

    expect(safe).not.toContain(token);
    expect(safe).not.toContain('query-secret');
    expect(safe).not.toContain('json-secret');
    expect(safe).not.toContain('bearer-secret');
    expect(safe).toContain('eo_token=***');
  });

  it('classifies actionable EdgeOne failure domains', () => {
    expect(classifyFailure('fetch failed: ECONNRESET', 1)).toBe('transport');
    expect(classifyFailure('HTTP 401 unauthorized invalid token', 1)).toBe('authentication');
    expect(classifyFailure('HTTP 429 quota exceeded', 1)).toBe('quota');
    expect(classifyFailure('HTTP 409 project already exists', 1)).toBe('project_conflict');
    expect(classifyFailure('The project dsh has finished versions. Uploads are only allowed for the latest version.', 1)).toBe('version_state');
    expect(classifyFailure('no valid JSON result', 0)).toBe('protocol');
    expect(classifyFailure('unexpected provider error', 1)).toBe('api');
    expect(classifyFailure('', 124, true)).toBe('transport');
  });

  it('extracts the last complete JSON object from mixed CLI output', () => {
    const result = parseLastJson([
      'Preparing deployment {not json}',
      '{"status":"progress","step":1}',
      'uploading...',
      '{',
      '  "status": "success",',
      '  "url": "https://preview.edgeone.app",',
      '  "projectId": "project-1",',
      '  "meta": {"nested": true}',
      '}',
      'done',
    ].join('\n'));

    expect(result).toEqual({
      status: 'success',
      url: 'https://preview.edgeone.app',
      projectId: 'project-1',
      meta: { nested: true },
    });
  });

  it('validates structured deployment success payloads', () => {
    expect(validateDeployResult({ status: 'success', url: 'https://example.com', projectId: 123 }).projectId).toBe(123);
    expect(() => validateDeployResult({ status: 'success', url: '', projectId: 123 })).toThrow('invalid success payload');
    expect(() => validateDeployResult({ status: 'error', url: 'https://example.com', projectId: 123 })).toThrow('invalid success payload');
  });
});
