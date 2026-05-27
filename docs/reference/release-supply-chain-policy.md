# Release Supply-Chain Policy

Proofyard distinguishes between repository-generated summaries and strong
release-grade proof.

## Current rule

The repository may generate:

- release notes
- SBOM summary files
- provenance summary files
- attestation summary files

These outputs help humans inspect release state, but they must not be marketed
as cryptographically strong proof unless a verifiable signing workflow exists.

## Public wording rule

Public release notes and docs must say one of these two things:

- this is a repository-side summary artifact
- this is a verifiable signed artifact

Never blur the line between the two.
