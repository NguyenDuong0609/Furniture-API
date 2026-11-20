/**
 * Task 2 — Preservation Property Tests (observe-first, run BEFORE the fix)
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4
 *
 * PURPOSE: These tests encode the INVARIANTS of the ORIGINAL config
 * (`include: ['**\/*.spec.ts']`) that must remain true both before and after
 * the fix is applied. All properties here MUST PASS on unfixed code.
 *
 * OBSERVATIONS recorded from unfixed code:
 *
 *   Observation A — `npm run test` (vitest run, include: **\/*.spec.ts):
 *     - Discovers unit test files matching **\/*.spec.ts across the project
 *     - Exits with code 0
 *     - Does NOT discover any *.int-spec.ts files (they don't match the glob)
 *
 *   Observation B — `npm run test:bench`:
 *     - Passes an explicit file path: test/integration/report-bench.int-spec.ts
 *     - Vitest resolves it directly (explicit paths bypass glob include in v4)
 *     - Exits with code 0
 *
 *   Observation C — glob invariant:
 *     - `**\/*.spec.ts` MATCHES foo.spec.ts → true
 *     - `**\/*.spec.ts` does NOT match foo.int-spec.ts → false
 *     - This is the invariant that keeps unit test runs clean (no integration
 *       files bleeding in) and also the root cause of the bug.
 *
 * FILE NOTE: Named *.spec.ts so it is discovered and run by the CURRENT
 * (unfixed) global config (`include: ['**\/*.spec.ts']`), allowing immediate
 * verification without any config changes.
 */

import picomatch from 'picomatch';
import * as fc from 'fast-check';
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns true when `pattern` matches `filePath` via picomatch. */
function globMatches(pattern: string, filePath: string): boolean {
  return picomatch(pattern)(filePath);
}

// ---------------------------------------------------------------------------
// Preservation Property 1 (Requirement 3.1):
//   Pure *.spec.ts files (no .int-spec.ts suffix) ARE matched by **/*.spec.ts.
//   This guarantees unit test discovery is never broken by the fix.
// ---------------------------------------------------------------------------

describe('Preservation: **/*.spec.ts matches pure unit-test files', () => {
  const UNIT_GLOB = '**/*.spec.ts';

  it('src/foo.spec.ts IS matched', () => {
    expect(globMatches(UNIT_GLOB, 'src/foo.spec.ts')).toBe(true);
  });

  it('src/auth/auth.service.spec.ts IS matched', () => {
    expect(globMatches(UNIT_GLOB, 'src/auth/auth.service.spec.ts')).toBe(true);
  });

  it('src/reports/reports.service.spec.ts IS matched', () => {
    expect(
      globMatches(UNIT_GLOB, 'src/reports/reports.service.spec.ts'),
    ).toBe(true);
  });

  /**
   * Property: for ANY filename whose suffix is exactly `.spec.ts`
   * (and whose base does NOT end with `.int`), the glob `**\/*.spec.ts`
   * will match it.
   *
   * Validates: Requirement 3.1
   */
  it('property — every pure *.spec.ts file is matched by **/*.spec.ts', () => {
    // Generate base names that do NOT end with ".int" so the resulting file
    // name ends with exactly ".spec.ts" (not ".int-spec.ts").
    const pureSpecArb = fc
      .tuple(
        fc
          .stringMatching(/^[a-z][a-z0-9-]{0,25}$/)
          .filter((s) => !s.endsWith('-int') && !s.endsWith('.int')),
        fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/), {
          minLength: 0,
          maxLength: 4,
        }),
      )
      .map(([base, segments]) => {
        const dir = segments.length ? segments.join('/') + '/' : '';
        return `${dir}${base}.spec.ts`;
      });

    fc.assert(
      fc.property(pureSpecArb, (filePath) => {
        return globMatches(UNIT_GLOB, filePath);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Preservation Property 2 (Requirements 3.1, 3.3):
//   *.int-spec.ts files are NOT matched by **/*.spec.ts.
//   This confirms that after the fix, running `npm run test` (unit tests)
//   will NOT accidentally pick up integration test files.
// ---------------------------------------------------------------------------

describe('Preservation: **/*.spec.ts does NOT match integration test files', () => {
  const UNIT_GLOB = '**/*.spec.ts';

  it('test/integration/reports.int-spec.ts is NOT matched', () => {
    expect(
      globMatches(UNIT_GLOB, 'test/integration/reports.int-spec.ts'),
    ).toBe(false);
  });

  it('test/integration/reports-adv.int-spec.ts is NOT matched', () => {
    expect(
      globMatches(UNIT_GLOB, 'test/integration/reports-adv.int-spec.ts'),
    ).toBe(false);
  });

  it('test/integration/report-bench.int-spec.ts is NOT matched', () => {
    expect(
      globMatches(UNIT_GLOB, 'test/integration/report-bench.int-spec.ts'),
    ).toBe(false);
  });

  /**
   * Property: for ANY filename ending with `.int-spec.ts`,
   * the glob `**\/*.spec.ts` will NOT match it.
   *
   * Validates: Requirements 3.1, 3.3
   */
  it('property — no *.int-spec.ts file is matched by **/*.spec.ts', () => {
    const intSpecArb = fc
      .tuple(
        fc.stringMatching(/^[a-z][a-z0-9-]{0,30}$/),
        fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/), {
          minLength: 0,
          maxLength: 4,
        }),
      )
      .map(([base, segments]) => {
        const dir = segments.length ? segments.join('/') + '/' : '';
        return `${dir}${base}.int-spec.ts`;
      });

    fc.assert(
      fc.property(intSpecArb, (filePath) => {
        return !globMatches(UNIT_GLOB, filePath);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Preservation Property 3 (Requirements 3.2, 3.4):
//   The NEW integration config glob **/*.int-spec.ts matches ALL *.int-spec.ts
//   files, including the three known integration test files and the bench file.
//   This confirms the fix will work correctly for test:integration and
//   test:integration:watch without altering unit test behaviour.
// ---------------------------------------------------------------------------

describe('Preservation: **/*.int-spec.ts matches all integration files', () => {
  const INT_GLOB = '**/*.int-spec.ts';

  it('test/integration/reports.int-spec.ts IS matched', () => {
    expect(
      globMatches(INT_GLOB, 'test/integration/reports.int-spec.ts'),
    ).toBe(true);
  });

  it('test/integration/reports-adv.int-spec.ts IS matched', () => {
    expect(
      globMatches(INT_GLOB, 'test/integration/reports-adv.int-spec.ts'),
    ).toBe(true);
  });

  it('test/integration/report-bench.int-spec.ts IS matched', () => {
    expect(
      globMatches(INT_GLOB, 'test/integration/report-bench.int-spec.ts'),
    ).toBe(true);
  });

  /**
   * Property: for ANY filename ending with `.int-spec.ts`, the glob
   * `**\/*.int-spec.ts` WILL match it — this is the guarantee that the new
   * integration config discovers every integration test file.
   *
   * Validates: Requirements 3.2, 3.4
   */
  it('property — every *.int-spec.ts file is matched by **/*.int-spec.ts', () => {
    const intSpecArb = fc
      .tuple(
        fc.stringMatching(/^[a-z][a-z0-9-]{0,30}$/),
        fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/), {
          minLength: 0,
          maxLength: 4,
        }),
      )
      .map(([base, segments]) => {
        const dir = segments.length ? segments.join('/') + '/' : '';
        return `${dir}${base}.int-spec.ts`;
      });

    fc.assert(
      fc.property(intSpecArb, (filePath) => {
        return globMatches(INT_GLOB, filePath);
      }),
    );
  });

  /**
   * Separation invariant: `**\/*.int-spec.ts` does NOT match pure `*.spec.ts` files.
   * This confirms the two globs are disjoint — the integration config won't
   * accidentally run unit tests.
   *
   * Validates: Requirement 3.1
   */
  it('property — no pure *.spec.ts file is matched by **/*.int-spec.ts', () => {
    const pureSpecArb = fc
      .tuple(
        fc
          .stringMatching(/^[a-z][a-z0-9-]{0,25}$/)
          .filter((s) => !s.endsWith('-int') && !s.endsWith('.int')),
        fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/), {
          minLength: 0,
          maxLength: 4,
        }),
      )
      .map(([base, segments]) => {
        const dir = segments.length ? segments.join('/') + '/' : '';
        return `${dir}${base}.spec.ts`;
      });

    fc.assert(
      fc.property(pureSpecArb, (filePath) => {
        return !globMatches(INT_GLOB, filePath);
      }),
    );
  });
});
