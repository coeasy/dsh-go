#!/usr/bin/env node
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertProviderAdapterRelease } from '../runtime/provider-adapter.mjs';
import {
  assertProviderAdapterRegistry,
  createEmptyProviderAdapterRegistry,
  registerProviderAdapter,
  rollbackProviderAdapterChannel,
} from '../runtime/provider-adapter-registry.mjs';

function option(args, name, fallback = undefined) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

function has(args, name) {
  return args.includes(name);
}

async function readRegistry(file) {
  try {
    return assertProviderAdapterRegistry(JSON.parse(await readFile(file, 'utf8')));
  } catch (error) {
    if (error?.code === 'ENOENT') return createEmptyProviderAdapterRegistry();
    throw error;
  }
}

async function atomicWriteJson(file, value) {
  await mkdir(dirname(file), { recursive: true });
  const temp = `${file}.tmp-${process.pid}`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, file);
}

function assertExpectedSource(release, options) {
  if (options.expectRepository && release.source?.repository !== options.expectRepository) {
    throw new Error(`provider adapter source repository mismatch: expected ${options.expectRepository}, got ${release.source?.repository || '<none>'}`);
  }
  if (options.expectTag && release.source?.tag !== options.expectTag) {
    throw new Error(`provider adapter source tag mismatch: expected ${options.expectTag}, got ${release.source?.tag || '<none>'}`);
  }
  if (options.expectRepository && options.expectTag) {
    const expectedPrefix = `https://github.com/${options.expectRepository}/releases/download/${encodeURIComponent(options.expectTag)}/`;
    if (!release.artifact.url?.startsWith(expectedPrefix)) throw new Error(`provider adapter artifact URL must originate from ${expectedPrefix}`);
  }
}

export async function publishProviderAdapter(options = {}) {
  const registryFile = resolve(options.registry || 'catalog/provider-adapters.json');
  const current = await readRegistry(registryFile);
  let result;
  let release = null;

  if (options.rollback) {
    if (!options.id) throw new Error('provider adapter rollback requires id');
    result = rollbackProviderAdapterChannel(current, options.id, options.channel || 'stable', options.toVersion || null, { at: options.at });
  } else {
    if (!options.release) throw new Error('provider adapter publish requires release file');
    release = assertProviderAdapterRelease(JSON.parse(await readFile(resolve(options.release), 'utf8')));
    assertExpectedSource(release, options);
    result = registerProviderAdapter(current, release, {
      channel: options.channel,
      forceChannel: options.forceChannel === true,
      at: options.at,
    });
  }

  if (result.changed) await atomicWriteJson(registryFile, result.registry);
  return {
    changed: result.changed,
    registry: registryFile,
    content_hash: result.registry.generated.content_hash,
    count: result.registry.generated.count,
    release_count: result.registry.generated.release_count,
    ...(release ? { id: release.id, version: release.version, release_id: release.release_id, channel: result.channel } : {
      id: options.id, channel: result.channel, from: result.from, to: result.to,
    }),
  };
}

export async function providerPublishCli(args = process.argv.slice(2)) {
  return publishProviderAdapter({
    registry: option(args, '--registry', 'catalog/provider-adapters.json'),
    release: option(args, '--release'),
    channel: option(args, '--channel'),
    rollback: has(args, '--rollback'),
    id: option(args, '--id'),
    toVersion: option(args, '--to-version'),
    forceChannel: has(args, '--force-channel'),
    expectRepository: option(args, '--expect-repository'),
    expectTag: option(args, '--expect-tag'),
    at: option(args, '--generated-at'),
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  providerPublishCli().then((result) => console.log(JSON.stringify(result, null, 2))).catch((error) => {
    console.error(`[provider-publish] ${error.stack || error.message}`);
    process.exit(1);
  });
}
