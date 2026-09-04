// Runtime compatibility facade over the canonical Policy Core permission contract.
// Permission semantics must not be reimplemented in Runtime modules.
export {
  KNOWN_PERMISSIONS,
  assertPermissionConsent,
  inspectPermissions,
  normalizePermissions,
  permissionDiff,
  permissionRisk,
} from '../packages/policy-core/permissions.mjs';
