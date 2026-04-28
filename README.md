# GPTPro GitHub Workbench

This repository captures the planning artefacts for a URL-first GitHub workbench that ChatGPT can use through a constrained Cloudflare-protected portal.

The immediate target use case is KS2 Mastery (`fol2/ks2-mastery`): ChatGPT should reach a public URL, inspect a tightly scoped workbench state, and request allowlisted GitHub actions through a broker backed by a private executor. The portal is not a general shell, broad web proxy, or unrestricted GitHub proxy.

## Contents

- `docs/plan/ks2-github-workbench-establishment-plan.md` - original establishment brief.
- `docs/plans/2026-04-28-001-feat-ks2-github-workbench-plan.md` - implementation plan for the URL-first portal/workbench direction.
- `@/2026-04-28-ks2-github-workbench-completion-report.md` - completion report for the planning artefact and recommended next implementation slice.

## Current Status

Planning is complete. The Cloudflare portal, private executor, authentication policy, broker API, and live readiness checks are not yet deployed.
