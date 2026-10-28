# Beta Hardening Plan (2026-10-26)

This implementation closes the user-reported image refresh gap and the remaining release-readiness work requested for ACP startup, PDF output size, update checking, and About information.

## Tasks and acceptance criteria

| Task | Files | Acceptance | Verification | Rollback risk |
|---|---|---|---|---|
| ACP launch reliability | `apps/desktop/src-tauri/src/agent_runtime/**`, ACP settings components and tests | Existing agent IDs remain stable; package-manager launches initialize within a realistic cold-start window; official Codex ACP bridge is used; timeout and failure paths remain actionable | Rust unit/integration tests, focused UI tests, Linux build | Medium: process startup and protocol timing |
| PDF image size | `apps/desktop/src/services/export.ts`, `pdf-image-optimization.ts` and tests | Raster images are bounded to print dimensions; vector, transparent, and unsupported images retain original fidelity; failed optimization falls back to source | Optimizer and export tests | Low: PDF-only transformation |
| Image refresh | `packages/editor-core/src/image/node-view.ts`, editor controller, `ImagePanel.vue`, form/i18n/tests | Manual refresh re-fetches current bytes; vault image changes refresh the preview; unrelated Markdown changes do not; natural dimensions update after refreshed load | Focused editor-core and desktop tests | Low: cache invalidation only |
| About/update check | Settings About view/service/i18n/tests, privacy notice | Shows app version and project information; explicit check reports stable GitHub release availability, supports retry/cancel, and never installs automatically | About/service/settings tests, typecheck | Low: opt-in network read |

## Release verification

Run from the repository root on Linux:

```bash
npx --yes pnpm typecheck
npx --yes pnpm lint
npx --yes pnpm test
npx --yes pnpm build
```

For Rust changes, also run the focused agent-runtime test suite and formatter check with no more than four build jobs. Do not publish packages until every required check passes.
