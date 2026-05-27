# Security Policy

## Reporting a vulnerability

Use GitHub private security advisories for sensitive reports.

- Do not disclose security issues in public issues or pull requests.
- Do not include secrets, tokens, private URLs, or runtime artifacts in public discussions.

If the repository UI does not expose private security reporting, stop and ask a
maintainer for a private path before sharing details.

## Response target

- Initial acknowledgement target: within 5 business days
- Coordinated disclosure should happen only after a fix or mitigation exists

## Sensitive data rules

- Never commit API keys, tokens, passwords, or private certificates.
- Treat `.runtime-cache/` as sensitive local runtime output.
- Keep real secrets in local `.env` only; publish examples through `.env.example`.

## Scope

Security reports may cover:

- application code
- CI workflows
- release artifacts
- public documentation that could expose sensitive information
