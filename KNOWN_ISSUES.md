# Known issues

## Vitest: jsdom test files can fail to start under load (mitigated, watch)

**Symptom.** In a full unit run (`npm test` in `apps/web`) one or more jsdom files (then `*.dom.test.ts`, now `src/test/**/*.test.tsx`)
were reported as `Error: [vitest-pool]: Failed to start forks worker … Timeout waiting for worker
to respond`, and the run still ended "N passed (N)" with exit 0. Seen 2026-10-28: 115 files /
1232 tests where the suite was 118 / 1264.

**Cause.** A forks worker must answer Vitest's start message within 60 s (`START_TIMEOUT`,
not configurable). For a jsdom file, start-up includes setting up the jsdom environment, which
alone takes several seconds on this machine; started at the same time as ~15 node workers that
are all transforming and importing server modules, it ran past 60 s.

**Mitigation (in place).**
- `vitest.config.ts` runs the jsdom files as a separate `dom` project, in its own group after
  the node files (`sequence.groupOrder: 1`) with `maxWorkers: 2`.
- `vitest-support/workerStartGuard.ts` is a reporter that sets a non-zero exit code when a worker
  fails to start or a scheduled file never finished.
- `npm run test:verify` compares the files that ran with `vitest list` and fails on a mismatch,
  on any worker-start error, or on a non-zero Vitest exit. It prints both numbers.

**Rule until this entry is removed.** A unit run counts as clean only if the files run equal
the `vitest list` count and there are no "Failed to start … worker" errors. Use
`npm run test:verify`, or report both numbers by hand.

**Remove this entry when** several loaded full runs in a row have shown no worker-start errors.
