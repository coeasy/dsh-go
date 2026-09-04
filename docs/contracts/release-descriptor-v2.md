# Release Descriptor V2

Release Descriptor V2 is the canonical immutable release record between Manifest V2 and Registry V4.

It exists to separate two different facts:

- **Manifest V2** describes the package declared by source code.
- **Release Descriptor V2** proves one immutable published release of that package.
- **Registry V4** may expose an installable release only after a valid Release Descriptor V2 exists.

This contract is intentionally fail-closed. A repository observation, branch head, star count, tag guess, README value, or mutable Git source is not enough to create an installable Registry V4 release.

## Canonical file

Each GitHub Release publishes:

```text
dsh-package-release.json
```

The checked-in JSON Schema is:

```text
schemas/dsh-package-release-v2.schema.json
```

Protocol Core owns semantic validation through:

```text
validatePackageReleaseDescriptor()
```

Runtime discovery, Registry ingestion, release packaging, tests, and architecture gates must delegate to this authority rather than reimplementing the contract.

## Required identity binding

A Descriptor V2 binds all of the following fields as one release identity:

```text
release_version = 2
protocol_version = 2
manifest_version = 2
type
id
version
channel
repository
commit
tag
published_at
manifest_file
package_path
manifest
artifact
```

The descriptor is invalid if any required identity field is missing, inconsistent, mutable, or cannot be canonicalized.

## Canonical tag

Repository-root packages use:

```text
v<version>
```

Scoped monorepo packages use:

```text
<release-safe-package-id>-v<version>
```

Example:

```text
coeasy-dsh-go-marketplace-plugin-v0.1.3
```

The descriptor tag must equal the value produced by Protocol Core `packageReleaseTag()`.

## Immutable commit

`commit` must be an exact 40-character Git commit SHA.

Registry V4 copies the descriptor commit into the canonical release record. The current repository branch head is only discovery input; it is not release authority.

This means later documentation, catalog, or source changes do not rewrite the identity of an already published release.

## Manifest binding

The embedded `manifest` must pass Manifest V2 validation and match descriptor:

```text
type
id
version
channel
repository source identity
package scope
```

For a scoped monorepo package, `manifest_file` must resolve to:

```text
<package_path>/dsh-package.json
```

For a repository-root package:

```text
dsh-package.json
```

## Artifact binding

The canonical release artifact is a GitHub Release archive:

```text
kind = release-archive
format = tgz
url = https://github.com/<owner>/<repo>/releases/download/<canonical-tag>/<asset>
digest = sha256-<64 lowercase hex>
strip_components = package-scope-dependent integer
```

The artifact URL must belong to the declared repository and canonical release tag.

The digest is the install authority used by Runtime verification and content-addressable storage. Registry V4 preserves both `digest` and normalized `integrity` for consumers.

## Publication time

`published_at` is required and normalized to ISO-8601.

The canonical release packer derives it deterministically from the immutable source commit timestamp so repeated packaging of the same commit produces the same descriptor bytes.

## Registry V4 ingestion

Registry construction follows this order:

```text
repository discovery / explicit scoped source
  -> observe Manifest V2
  -> derive canonical package coordinate and tag
  -> fetch dsh-package-release.json from GitHub Release
  -> validate Descriptor V2
  -> accept or quarantine candidate
  -> build Registry V4 release from Descriptor V2
```

A package is quarantined when the descriptor is missing or invalid.

Official required packages are guarded by `config/registry-v4-sources.json`. Registry publication is deferred until every required package has an accepted immutable Descriptor V2, preventing a partially published official Registry during concurrent package releases.

## Runtime consumption

Runtime may discover a Descriptor V2 when resolving an older Registry record without a release archive, but it must validate the descriptor through Protocol Core before using its artifact.

New Registry V4 releases should already carry the immutable release archive and digest, so normal installation does not rely on a mutable Git checkout.

## Security boundary

Release Descriptor V2 proves release identity and artifact immutability. It does not by itself mean the publisher is trusted.

Trust remains a separate decision based on publisher ownership, signing/provenance verification, advisories, policy, permissions, compatibility, revocation, and Runtime approval.

Popularity signals such as stars or ranking never create trust or release authority.

## Version stability

This hardening keeps the public architecture versions stable:

```text
Protocol V2
Manifest V2
Release Descriptor V2
Registry V4
Distribution V2
Search Index V3
Runtime State V4
API V2
```

No legacy Descriptor V1 compatibility path is provided.
