# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities **privately** via GitHub Security Advisories:

1. Go to https://github.com/Kubedoll-Heavy-Industries/pulumi-playit/security/advisories
2. Click "Report a vulnerability"
3. Provide a clear description, reproduction steps, and impact assessment

We aim to acknowledge reports within 72 hours and to publish a fix or mitigation
within 30 days for confirmed vulnerabilities. Please do not file public GitHub
issues for security problems.

## Supply Chain Posture

This package follows a "pin-everything" supply-chain hardening posture intended
to limit blast radius from upstream compromises (e.g. the chalk/debug npm
takeover, `ua-parser-js` typosquats, `tj-actions/changed-files` GitHub Actions
compromise, Shai-Hulud worm patterns).

### What we do

- **Exact-pinned dependencies.** Every entry in `dependencies` and
  `devDependencies` is pinned to an exact version (no `^` / `~` ranges).
  Peer deps remain ranged (they describe a contract, not an install).
- **Frozen lockfile in CI.** `pnpm install --frozen-lockfile` is used in
  every CI job, so a drifted lockfile fails the build.
- **SHA-pinned GitHub Actions.** Every `uses:` in our workflows is pinned
  to a 40-character commit SHA, with the human-readable tag as a comment.
- **Minimal workflow permissions.** Workflows declare `permissions: {}` at
  the top level and grant only the specific scopes each job needs.
- **Build provenance attestations.** Releases are accompanied by Sigstore
  build-provenance attestations via `actions/attest-build-provenance`.

### Verifying a release

After installing a published version, you can verify the build provenance:

```bash
# Download the tarball published to GitHub Packages
npm pack @kubedoll-heavy-industries/pulumi-playit@<version>

# Verify the Sigstore attestation
gh attestation verify ./kubedoll-heavy-industries-pulumi-playit-<version>.tgz \
  --owner Kubedoll-Heavy-Industries
```

A successful verification proves the tarball was built by our CI from a
specific commit in this repository.

### npm-CLI `--provenance` note

The `npm publish --provenance` flag uploads provenance to the **public npm
registry only**. Because this package is published to **GitHub Packages**
(`npm.pkg.github.com`), we use `actions/attest-build-provenance` instead,
which writes Sigstore attestations to GitHub's attestation store. The
security guarantee is equivalent: a Sigstore-signed statement linking the
tarball's SHA-256 digest to the workflow run that produced it.

### `prepare` script

We run `pnpm run build` from the `prepare` lifecycle script so that
consumers installing the package directly from a git ref get a built
`dist/`. The published tarball already contains `dist/`, so `prepare`
is effectively a no-op for normal `pnpm add` flows. No network access
or arbitrary code execution beyond `tsc` happens during `prepare`.
