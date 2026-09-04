import { formatPackageCoordinate, parsePackageCoordinate } from '../packages/protocol-core/index.mjs';
import { buildInstallUri, parseDshUri, protocolRegistration, registerProtocolHandler } from './host-bridge.mjs';

/** Build the only supported package deep link. */
export function buildPackageDeepLink(coordinate, options = {}) {
  return buildInstallUri(coordinate, options);
}

/** Parse and validate the only supported package deep link. */
export function parsePackageDeepLink(input) {
  return parseDshUri(input);
}

/**
 * Produce a local execution plan. This module never performs a package
 * mutation and never accepts a Registry override from a remote link.
 */
export function deepLinkInstallPlan(input) {
  const link = typeof input === 'string'
    ? parseDshUri(input)
    : (() => {
        const request = parsePackageCoordinate(input.coordinate, { channel: input.channel || 'stable' });
        return { protocol: 'dsh', version: 2, action: 'install', request, coordinate: formatPackageCoordinate(request) };
      })();
  return {
    request: link.request,
    executable: 'dsh',
    argv: ['package', 'install', link.coordinate, '--channel', link.request.channel],
    confirmation_required: true,
    remote_registry_override_allowed: false,
    auto_restart: false,
    restart_required_after_success: true,
  };
}

export function packageProtocolRegistrationPlan(options = {}) {
  return protocolRegistration(options);
}

export async function registerPackageProtocol(options = {}) {
  return registerProtocolHandler(options);
}
