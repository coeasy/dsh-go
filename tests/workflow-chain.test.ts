import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workflow = (name: string) => readFileSync(resolve(root, '.github/workflows', name), 'utf8');

describe('Sync V3 -> deploy closure', () => {
  it('explicitly dispatches every deployment after a deploy-worthy sync commit', () => {
    const sync = workflow('sync.yml');

    expect(sync).toContain('actions: write');
    expect(sync).toContain('id: publish');
    expect(sync).toContain('commit_sha=$(git rev-parse HEAD)');
    expect(sync).toContain("if: steps.publish.outputs.pushed == 'true' && steps.diff.outputs.data_changed == 'true'");
    expect(sync).toContain('for workflow in deploy.yml deploy-pages.yml deploy-mirror.yml; do');
    expect(sync).toContain('gh workflow run "$workflow" --ref main');
  });

  it('keeps every dispatch target manually dispatchable', () => {
    for (const name of ['deploy.yml', 'deploy-pages.yml', 'deploy-mirror.yml']) {
      expect(workflow(name), name).toContain('workflow_dispatch:');
    }
  });

  it('gates deployed Registry V3 against the latest main registry', () => {
    const monitor = workflow('monitor.yml');

    expect(monitor).toContain('uses: actions/checkout@v4');
    expect(monitor).toContain('ref: main');
    expect(monitor).toContain('MAIN_HASH=');
    expect(monitor).toContain('MAIN_COUNT=');
    expect(monitor).toContain('META_HASH=');
    expect(monitor).toContain('REG_HASH=');
    expect(monitor).toContain('API_HASH=');
    expect(monitor).toContain('Deployed Registry V3 did not converge to main');
  });
});
