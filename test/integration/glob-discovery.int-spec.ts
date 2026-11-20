/**
 * Task 1 — Bug Condition Exploration Property Test
 *
 * Validates: Requirements 1.1, 1.2
 *
 * PURPOSE: This test MUST FAIL on unfixed code to confirm the bug exists.
 * It encodes the EXPECTED (fixed) behaviour. After the fix is applied it
 * should PASS.
 *
 * BUG CONDITION: `vitest run test/integration` with `include: ['**\/*.spec.ts']`
 * never discovers *.int-spec.ts files because the glob `**\/*.spec.ts` does
 * not match filenames whose suffix is `.int-spec.ts`. Vitest v4 therefore has
 * an empty candidate list before even applying the directory filter, so it
 * exits with code 1 and "No test files found".
 *
 * COUNTEREXAMPLE recorded from live run (unfixed code):
 *   $ npx dotenv -e .env.test -- vitest run test/integration
 *   No test files found, exiting with code 1
 *   filter:  test/integration
 *   include: **\/*.spec.ts
 *   exclude: **\/node_modules\/**, **\/.git\/**
 *   exit code: 1
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
// Property 1 (Bug Condition):
//   *.int-spec.ts files are NOT matched by **\/*.spec.ts
//   This confirms the root cause: the existing global include glob silently
//   excludes every integration test file.
// ---------------------------------------------------------------------------

describe('Bug Condition: glob **/*.spec.ts excludes *.int-spec.ts files', () => {
  const INT_SPEC_GLOB = '**/*.spec.ts'; // current (buggy) global include

  it('reports.int-spec.ts is NOT matched by **/*.spec.ts', () => {
    expect(
      globMatches(INT_SPEC_GLOB, 'test/integration/reports.int-spec.ts'),
    ).toBe(false);
  });

  it('reports-adv.int-spec.ts is NOT matched by **/*.spec.ts', () => {
    expect(
      globMatches(INT_SPEC_GLOB, 'test/integration/reports-adv.int-spec.ts'),
    ).toBe(false);
  });

  it('report-bench.int-spec.ts is NOT matched by **/*.spec.ts', () => {
    expect(
      globMatches(INT_SPEC_GLOB, 'test/integration/report-bench.int-spec.ts'),
    ).toBe(false);
  });

  /**
   * Property: for ANY filename whose extension is `.int-spec.ts`,
   * the glob `**\/*.spec.ts` will NOT match it.
   * This is the universal statement of the root cause.
   *
   * Validates: Requirements 1.2
   */
  it('property — no *.int-spec.ts file is matched by **/*.spec.ts', () => {
    // Generate file names like "some-words.int-spec.ts" under arbitrary dirs
    const fileNameArb = fc
      .tuple(
        fc.stringMatching(/^[a-z][a-z0-9-]{0,30}$/), // base name
        fc.array(fc.stringMatching(/^[a-z][a-z0-9-]{0,15}$/), {
          minLength: 0,
          maxLength: 4,
        }), // path segments
      )
      .map(([base, segments]) => {
        const dir = segments.length ? segments.join('/') + '/' : '';
        return `${dir}${base}.int-spec.ts`;
      });

    fc.assert(
      fc.property(fileNameArb, (filePath) => {
        return !globMatches(INT_SPEC_GLOB, filePath);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Property 2 (Expected / Fixed Behaviour):
//   The FIXED config uses include: ['**\/*.int-spec.ts'].
//   After the fix, all three known integration test files MUST be matched.
//   This sub-section encodes the expected correct state; it currently asserts
//   the future behaviour.
//
//   Validates: Requirements 2.1, 2.2
// ---------------------------------------------------------------------------

describe('Expected Fixed Behaviour: **/*.int-spec.ts glob matches integration files', () => {
  const FIXED_GLOB = '**/*.int-spec.ts'; // new include in vitest.config.integration.ts

  it('reports.int-spec.ts IS matched by **/*.int-spec.ts', () => {
    expect(
      globMatches(FIXED_GLOB, 'test/integration/reports.int-spec.ts'),
    ).toBe(true);
  });

  it('reports-adv.int-spec.ts IS matched by **/*.int-spec.ts', () => {
    expect(
      globMatches(FIXED_GLOB, 'test/integration/reports-adv.int-spec.ts'),
    ).toBe(true);
  });

  it('report-bench.int-spec.ts IS matched by **/*.int-spec.ts', () => {
    expect(
      globMatches(FIXED_GLOB, 'test/integration/report-bench.int-spec.ts'),
    ).toBe(true);
  });

  /**
   * Property: for ANY filename whose extension is `.int-spec.ts`,
   * the glob `**\/*.int-spec.ts` WILL match it.
   *
   * Validates: Requirements 2.1
   */
  it('property — every *.int-spec.ts file IS matched by **/*.int-spec.ts', () => {
    const fileNameArb = fc
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
      fc.property(fileNameArb, (filePath) => {
        return globMatches(FIXED_GLOB, filePath);
      }),
    );
  });
});
