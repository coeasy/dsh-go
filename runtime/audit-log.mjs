import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runtimeRoot } from './registry.mjs';
import { withFileLock } from './file-lock.mjs';

export const AUDIT_EVENT_VERSION = 1;
const SECRET_KEY_RE = /(secret|token|password|credential|authorization|api[_-]?key|private[_-]?key)/i;
const MAX_TEXT = 2048;

export function auditLogPath() {
  return resolve(process.env.DSH_AUDIT_LOG || join(runtimeRoot(), 'logs', 'audit-v1.jsonl'));
}

function truncate(value) {
  const text = String(value ?? '');
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text;
}

export function redactAuditValue(value, key = '') {
  if (SECRET_KEY_RE.test(key)) return '<redacted>';
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => redactAuditValue(item));
  if (!value || typeof value !== 'object') return typeof value === 'string' ? truncate(value) : value;
  const output = {};
  for (const [childKey, child] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(childKey)) output[childKey] = '<redacted>';
    else output[childKey] = redactAuditValue(child, childKey);
  }
  return output;
}

export function createAuditEvent(event = {}) {
  return {
    event_version: AUDIT_EVENT_VERSION,
    timestamp: event.timestamp || new Date().toISOString(),
    request_id: event.request_id || event.requestId || randomUUID(),
    operation_id: event.operation_id || event.operationId || event.transaction_id || null,
    transaction_id: event.transaction_id || null,
    operation: event.operation || 'unknown',
    package_coordinate: event.package_coordinate || event.package || null,
    registry_revision: event.registry_revision || null,
    resolution_hash: event.resolution_hash || null,
    policy: event.policy || null,
    generation_before: Number.isFinite(event.generation_before) ? event.generation_before : null,
    generation_after: Number.isFinite(event.generation_after) ? event.generation_after : null,
    result: event.result || 'unknown',
    duration_ms: Number.isFinite(event.duration_ms) ? Math.max(0, Math.round(event.duration_ms)) : null,
    error_code: event.error_code || null,
    recoverable: event.recoverable === true,
    recovery_required: event.recovery_required === true,
    details: event.details || null,
  };
}

export async function appendAuditEvent(event, options = {}) {
  if (options.disabled === true || process.env.DSH_AUDIT_DISABLED === '1') return null;
  const file = resolve(options.file || auditLogPath());
  const sanitized = redactAuditValue(createAuditEvent(event));
  await mkdir(dirname(file), { recursive: true });
  await withFileLock(`${file}.lock`, () => appendFile(file, `${JSON.stringify(sanitized)}\n`, { encoding: 'utf8', mode: 0o600 }), {
    timeoutMs: Number(options.timeoutMs || 5000),
    staleMs: Number(options.staleMs || 30_000),
  });
  return sanitized;
}
