# Template Exchange MVP

Wave 5 keeps template exchange intentionally small.

The goal is not a marketplace. The goal is a trustworthy import/export/share loop.

## What Exists Now

- `GET /api/templates/{template_id}/export`
- `POST /api/templates/import`

That gives you a minimal roundtrip:

1. export a template bundle
2. review the scrubbed payload
3. import it into another checkout that already has the matching flow

## Exchange Rules

- exported defaults stay scrubbed
- secret-like values do not come back as raw reusable defaults
- import reuses the current checkout's existing flow id
- import creates a new template record; it does not silently overwrite another template

## What This Is Good For

Use template exchange when:

- one maintainer has already shaped a reusable template
- another checkout needs the same template contract
- you want a reviewable payload instead of hand-copying fields

## What This Is Not

This MVP is **not**:

- a public gallery
- a marketplace
- ratings or discovery
- moderation
- cross-tenant publishing
- a community ecosystem surface

Those belong to a separate program, not to this closeout wave.
