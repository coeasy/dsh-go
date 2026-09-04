export type PackageType = 'plugin' | 'mcp' | 'skill' | 'agent';
export type ReleaseChannel = 'stable' | 'beta' | 'nightly' | 'dev';

export interface PackageRequest {
  type: PackageType;
  id: string;
  range: string;
  channel: ReleaseChannel;
  registry?: string;
}

export interface ParsedVersion {
  raw: string;
  major: number;
  minor: number;
  patch: number;
  prerelease: readonly string[];
  build: readonly string[];
}

export const PACKAGE_TYPES: readonly PackageType[];
export const RELEASE_CHANNELS: readonly ReleaseChannel[];
export const ERROR_CODES: Readonly<Record<string, string>>;

export class ProtocolError extends Error {
  readonly code: string;
  readonly details?: unknown;
  constructor(code: string, message: string, details?: unknown);
}

export function normalizePackageType(value: unknown): PackageType;
export function normalizePackageId(value: unknown): string;
export function normalizeReleaseChannel(value?: unknown): ReleaseChannel;
export function parseVersion(value: unknown): ParsedVersion;
export function compareVersion(left: string, right: string): number;
export function normalizeVersionRange(value?: unknown): string;
export function satisfiesRange(version: string, range?: string): boolean;
export function selectHighest(versions: readonly string[], range?: string): string | null;
export function packageKey(type: unknown, id: unknown): string;
export function normalizePackageRequest(input: {
  type?: unknown;
  id?: unknown;
  range?: unknown;
  channel?: unknown;
  registry?: unknown;
}): Readonly<PackageRequest>;
export function parsePackageCoordinate(value: unknown, options?: { channel?: unknown; registry?: unknown }): Readonly<PackageRequest>;
export function formatPackageCoordinate(request: PackageRequest): string;
