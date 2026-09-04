export declare const KNOWN_PERMISSIONS: readonly string[];
export type PermissionRisk = 'low' | 'medium' | 'high';
export interface PermissionDescriptor { name?: string; id?: string; permission?: string; }
export interface PermissionInspection {
  permissions: string[];
  unknown: string[];
  dangerous: string[];
  requires_consent: boolean;
  risks: Array<{ permission: string; level: PermissionRisk }>;
}
export declare function normalizePermissions(value: unknown): string[];
export declare function permissionRisk(permission: string): PermissionRisk;
export declare function inspectPermissions(value: unknown): PermissionInspection;
export declare function permissionDiff(previousValue: unknown, nextValue: unknown): {
  added: string[];
  removed: string[];
  unchanged: string[];
};
export declare function assertPermissionConsent(value: unknown, options?: { approved?: boolean }): PermissionInspection;
