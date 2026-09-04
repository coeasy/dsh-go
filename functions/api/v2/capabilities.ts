import { PACKAGE_TYPES, RELEASE_CHANNELS } from '../../../packages/protocol-core/index.mjs';
import { apiData, optionsResponse, requestId } from '../../_api-v2';
import type { Env } from '../../_lib';

export const onRequestGet: PagesFunction<Env> = async ({ request }) => apiData({
  package_types: PACKAGE_TYPES,
  release_channels: RELEASE_CHANNELS,
  coordinate: '<type>:<id>@<semver-range>',
  deep_link: 'dsh://package/install?spec=<urlencoded-coordinate>&channel=<channel>',
  cli: 'dsh package <command>',
  registry_schema: 4,
  distribution_version: 2,
  search_index_version: 3,
}, { request_id: requestId(request) });

export const onRequestOptions: PagesFunction = () => optionsResponse();
