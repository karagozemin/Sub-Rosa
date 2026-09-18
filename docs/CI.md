# CI and quality gates

This document describes automated checks that protect the TypeScript workspace
(`packages/*` and `services/*`).

The web app also has a dedicated `.github/workflows/web.yml` check on pull
requests and pushes to `main`: `pnpm web:typecheck`, `pnpm web:test`, and
`pnpm web:build`. Its dependency installation builds the workspace packages
through the root postinstall script. The build emits a Vite manifest for
inspecting static entry dependencies separately from lazy route chunks.

## Test coverage gate

The repository enforces a minimum **aggregate line coverage** threshold for
TypeScript packages and services that ship unit tests.

| Setting | Location | Default |
| --- | --- | --- |
| Threshold | `coverage.config.json` → `lineThresholdPercent` | `70` |
| Workspaces | `coverage.config.json` → `workspaces` | SDK, tlock, bindings, keeper, agent, appraisal-api, receipt-cli, auction-template |

### How coverage is computed

1. Each configured workspace runs its existing `test` script under the Node.js
   test runner with `--experimental-test-coverage`.
2. Coverage is collected via the machine-readable **lcov** reporter (not the
   human TAP/spec summary table).
3. Test files (`*.test.ts`) are excluded; every non-test file under `src/` is
   included. Files never loaded by tests still contribute their source lines as
   **uncovered**.
4. The script prints per-workspace covered/total line counts and a **weighted**
   aggregate: `sum(covered) / sum(total)` across all configured workspaces.
5. CI fails when the weighted aggregate drops below `lineThresholdPercent`.
6. CI also rejects test files omitted from a workspace's standard test command.

Runner unit tests live in `scripts/run-ts-coverage.test.mjs`
(`node --test scripts/run-ts-coverage.test.mjs`).

### Run locally

```bash
pnpm install
pnpm coverage:test
```

### CI workflow

GitHub Actions workflow: `.github/workflows/coverage.yml`

It runs on pushes and pull requests to `main`, prints the coverage summary to
the job log, and fails the check when the threshold is not met.

### Changing the threshold

Update `lineThresholdPercent` in `coverage.config.json` and mention the change
in the PR. The default is calibrated against the **weighted** covered/total
ratio after including unexecuted `src/` files. Lower the threshold only when
the existing codebase cannot meet a higher bar yet; prefer adding tests instead
of weakening the gate.


## Current landing bundle measurement

The 2026-09-18 production build emits 352.47 kB of initial static JavaScript
(113.90 kB gzip), versus the earlier monolithic approximately 3.08 MB bundle.
This measures the landing entry and its static import closure, not the total
assets downloaded after opening every pilot. Deferred crypto/SDK dependencies
still produce chunks over 500 kB. Inspect `apps/web/dist/.vite/manifest.json`
after `pnpm web:build` to distinguish entry imports from dynamic route imports.

`pnpm protocol:prepare` separately builds local versioned protocol release
artifacts and checks bindings; it never publishes packages or sends transactions.
