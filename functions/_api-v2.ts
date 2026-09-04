import { ProtocolError } from '../packages/protocol-core/index.mjs';

export interface ApiMeta {
  request_id: string;
  registry_revision?: string;
  [key: string]: unknown;
}

export function requestId(request: Request): string {
  return request.headers.get('x-request-id') || crypto.randomUUID();
}

function headers(cacheControl = 'public, max-age=60, stale-while-revalidate=300'): HeadersInit {
  return {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': cacheControl,
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type, if-none-match, x-request-id',
  };
}

export function apiData(data: unknown, meta: ApiMeta, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify({ data, meta }), {
    ...init,
    headers: { ...headers(), ...(init.headers || {}) },
  });
}

export function apiError(error: unknown, meta: ApiMeta, status = 500): Response {
  const protocol = error instanceof ProtocolError;
  const code = protocol ? error.code : 'DSH_INTERNAL_ERROR';
  const message = error instanceof Error ? error.message : String(error);
  const details = protocol ? error.details : undefined;
  return new Response(JSON.stringify({
    error: { code, message, ...(details === undefined ? {} : { details }) },
    meta,
  }), {
    status,
    headers: headers('no-store'),
  });
}

export function statusForError(error: unknown): number {
  if (!(error instanceof ProtocolError)) return 500;
  if (error.code === 'DSH_PACKAGE_NOT_FOUND') return 404;
  if (error.code === 'DSH_PACKAGE_REVOKED' || error.code === 'DSH_PACKAGE_YANKED' || error.code === 'DSH_SECURITY_ADVISORY_BLOCKED') return 409;
  if (error.code === 'DSH_DEPENDENCY_CONFLICT') return 409;
  return 400;
}

export function optionsResponse(): Response {
  return new Response(null, { status: 204, headers: headers('no-store') });
}

export function parseJsonBody(request: Request): Promise<any> {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) throw new ProtocolError('DSH_INVALID_REQUEST', 'Content-Type must be application/json');
  return request.json();
}
