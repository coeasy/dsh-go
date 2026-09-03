import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { findPackageManifest } from './package-manifest.mjs';
import { publisherOwnership, validateManifestV2 } from './manifest-v2.mjs';
import { auditPackageSecurity } from '../scripts/package-security-audit.mjs';
import { generateSbom } from '../scripts/generate-sbom.mjs';

function sha256(value) { return createHash('sha256').update(value).digest('hex'); }

export async function inspectPublisherPackage(root = process.cwd()) {
  const target = resolve(root);
  const found = await findPackageManifest(target);
  if (!found) throw new Error(`no DSH package manifest found: ${target}`);
  const v2 = validateManifestV2(found.data, { file: found.file });
  const ownership = publisherOwnership(v2.manifest);
  const audit = await auditPackageSecurity(target);
  const security = v2.manifest?.security || {};
  const evidence = {
    provenance: Boolean(security.provenance),
    signature: Boolean(security.signature),
    sbom: Boolean(security.sbom),
    license: Boolean(security.license),
  };
  const immutable = /^[0-9a-f]{40}$/i.test(v2.manifest?.source?.commit || '');
  const publishable = v2.valid && audit.safe && immutable && ownership.verified && Object.values(evidence).every(Boolean);
  return {
    root: target,
    manifest_file: found.file,
    manifest_v2: v2,
    ownership,
    audit,
    evidence,
    immutable_source_commit: immutable,
    publishable,
    missing: [
      ...(!immutable ? ['source.commit'] : []),
      ...(!ownership.verified ? ['publisher.repository_ownership=verified'] : []),
      ...Object.entries(evidence).filter(([, enabled]) => !enabled).map(([name]) => `security.${name}`),
    ],
  };
}

export async function buildPublisherSubmission(root = process.cwd(), options = {}) {
  const inspection = await inspectPublisherPackage(root);
  const sbom = await generateSbom(inspection.root);
  const manifest = inspection.manifest_v2.manifest;
  const submission = {
    submission_version: 1,
    generated_at: new Date().toISOString(),
    package: {
      key: `${manifest.type}:${manifest.id}`,
      type: manifest.type,
      id: manifest.id,
      version: manifest.version,
      source: manifest.source,
      publisher: manifest.publisher,
      release: manifest.release,
    },
    manifest,
    ownership: inspection.ownership,
    audit: { safe: inspection.audit.safe, findings: inspection.audit.findings || [] },
    sbom: { format: sbom.bomFormat || 'CycloneDX', components: sbom.components?.length || 0, digest: sha256(JSON.stringify(sbom)) },
    publishable: inspection.publishable,
    missing: inspection.missing,
    mutation: false,
    registry_submission: 'pull-request-or-approved-publisher-workflow',
  };
  const outputDir = resolve(options.outputDir || join(inspection.root, '.dsh-publish'));
  await mkdir(outputDir, { recursive: true });
  const manifestFile = join(outputDir, 'dsh-package-v2.json');
  const sbomFile = join(outputDir, 'sbom.cdx.json');
  const submissionFile = join(outputDir, 'submission.json');
  await writeFile(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(sbomFile, `${JSON.stringify(sbom, null, 2)}\n`, 'utf8');
  await writeFile(submissionFile, `${JSON.stringify(submission, null, 2)}\n`, 'utf8');
  return { ...submission, files: { manifest: manifestFile, sbom: sbomFile, submission: submissionFile } };
}
