import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { assertProviderAdapterRegistry } from '../runtime/provider-adapter-registry.mjs';

describe('Provider Adapter release workflow contracts', () => {
  it('ships a reusable deterministic release pipeline pinned to the called workflow SHA', async () => {
    const workflow = await readFile('.github/workflows/provider-adapter-release.yml', 'utf8');
    expect(workflow).toContain('workflow_call:');
    expect(workflow).toContain('job_workflow_sha');
    expect(workflow).toContain('steps.toolkit.outputs.sha');
    expect(workflow).toContain('Rebuild and prove byte-for-byte reproducibility');
    expect(workflow).toContain('cmp dist/provider-adapter-release.json');
    expect(workflow).toContain('uses: actions/attest@v4');
    expect(workflow).toContain('sbom-path: dist/provider-adapter-sbom.spdx.json');
    expect(workflow).toContain('Create or verify immutable GitHub Release');
    expect(workflow).toContain('repository_dispatch');
  });

  it('ingests marketplace releases through source-bound idempotent registry PRs', async () => {
    const workflow = await readFile('.github/workflows/provider-adapter-marketplace.yml', 'utf8');
    expect(workflow).toContain('repository_dispatch:');
    expect(workflow).toContain('--expect-repository "$SOURCE_REPOSITORY"');
    expect(workflow).toContain('--expect-tag "$SOURCE_TAG"');
    expect(workflow).toContain('catalog/provider-adapters.json');
    expect(workflow).toContain('gh pr create');
  });

  it('routes dsh provider separately without changing the stable CLI core', async () => {
    const wrapper = await readFile('bin/dsh.mjs', 'utf8');
    expect(wrapper).toContain("args[0] === 'provider'");
    expect(wrapper).toContain("../runtime/provider-cli.mjs");
    expect(wrapper).toContain("./dsh-core.mjs");
  });

  it('keeps a valid empty Provider Adapter Registry V1 in source control', async () => {
    const registry = assertProviderAdapterRegistry(JSON.parse(await readFile('catalog/provider-adapters.json', 'utf8')));
    expect(registry.generated.count).toBe(0);
    expect(registry.generated.release_count).toBe(0);
    expect(registry.providers).toEqual([]);
  });
});
