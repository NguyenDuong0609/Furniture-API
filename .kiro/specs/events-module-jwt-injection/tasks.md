# Implementation Plan

## Overview

Fix the `UnknownDependenciesException` that prevents the NestJS application from booting by importing `JwtModule.registerAsync` into `EventsModule`. The workflow follows the exploratory bugfix methodology: surface the bug with a property-based test, capture preservation behaviour, apply the single-line module fix, then validate both the fix and regressions.

## Tasks

- [ ] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - EventsModule Missing JwtModule Import
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the `UnknownDependenciesException` exists
  - **Scoped PBT Approach**: For this deterministic DI bug, scope the property to the concrete failing case: creating a NestJS testing module that registers `EventsGateway` WITHOUT importing `JwtModule`
  - Create a NestJS `Test.createTestingModule` harness that includes `EventsGateway` as a provider but does NOT import `JwtModule`
  - Assert that `TestingModule.compile()` rejects with `UnknownDependenciesException` mentioning `JwtService` at index [0] (from Bug Condition in design: `'JwtModule' NOT IN module.imports AND 'JwtService' IN constructorDependencies(EventsGateway)`)
  - Run test on UNFIXED code (`EventsModule` without `JwtModule` import)
  - **EXPECTED OUTCOME**: Test FAILS with `UnknownDependenciesException: Nest can't resolve dependencies of the EventsGateway (?, PrismaService)` — this is correct and proves the bug exists
  - Document the exact counterexample error message found
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2_

- [ ] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - WebSocket Runtime Behaviour Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Set up a test harness with `EventsModule` fixed (or mock `JwtService` + `PrismaService`) to observe runtime gateway behaviour on non-buggy inputs (cases where the module boots successfully)
  - Observe: `handleConnection` with a valid JWT populates `client.userId`, `client.role`, adds socket to `userSockets`, and joins `user_<id>` room (and `admins` if ADMIN)
  - Observe: `handleConnection` with missing/invalid token calls `client.disconnect()`
  - Observe: `handleDisconnect` removes the socket from `userSockets` and deletes the user entry when no sockets remain
  - Observe: `sendNotification(userId, data)` calls `server.to('user_<userId>').emit('notification', data)`
  - Observe: `sendToAdmins(event, data)` calls `server.to('admins').emit(event, data)`
  - Write property-based test: for all valid JWT payloads with any `sub` (userId) and role, `handleConnection` always populates `client.userId` and joins `user_<userId>` room (from Preservation Requirements in design)
  - Write property-based test: for all random `userId` values, `sendNotification` always targets `user_<userId>` room
  - Verify all preservation tests PASS on correctly-booted (unfixed logic, but functional) code
  - **EXPECTED OUTCOME**: Tests PASS — this confirms the baseline runtime behaviour to preserve
  - Mark task complete when tests are written, run, and passing on unfixed gateway logic
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 3. Fix for missing JwtModule import in EventsModule

  - [ ] 3.1 Implement the fix in `src/events/events.module.ts`
    - Add `imports` array to the `@Module()` decorator of `EventsModule`
    - Import `ConfigModule` from `@nestjs/config` so the `registerAsync` factory can inject `ConfigService`
    - Import `JwtModule.registerAsync` mirroring the exact pattern used in `AuthModule`: inject `ConfigService`, read `JWT_SECRET` with `'default_secret'` fallback, read `JWT_EXPIRES_IN` with `'1h'` fallback
    - No changes to `EventsGateway`, its constructor, event handlers, room names, or message payloads
    - _Bug_Condition: isBugCondition(EventsModule) where 'JwtModule' NOT IN EventsModule.imports AND 'JwtService' IN constructorDependencies(EventsGateway)_
    - _Expected_Behavior: bootstrapModule(EventsModule_fixed).exceptionThrown = false AND eventsGateway instanceof EventsGateway AND jwtService instanceof JwtService_
    - _Preservation: All WebSocket authentication, room management, notification dispatch, and message routing behaviour remain identical; only the module imports array changes_
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 3.4, 3.5_

  - [ ] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Application Boots Without DI Exception
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior: module compilation must NOT throw `UnknownDependenciesException`
    - When this test passes, it confirms `JwtService` is successfully resolved at `EventsGateway` constructor index [0]
    - Run the bug condition exploration test from step 1 against the fixed `EventsModule`
    - **EXPECTED OUTCOME**: Test PASSES — confirms the DI bug is resolved
    - _Requirements: 2.1, 2.2_

  - [ ] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - WebSocket Runtime Behaviour Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run all preservation property tests from step 2 against the fixed module
    - **EXPECTED OUTCOME**: Tests PASS — confirms no regressions in authentication, room management, notifications, or message routing
    - Confirm all tests still pass after fix (no regressions)

- [ ] 4. Checkpoint - Ensure all tests pass
  - Run the full test suite to confirm both the bug condition exploration test and all preservation tests pass
  - Verify no other modules or services are broken by the `EventsModule` change
  - Ensure all tests pass; ask the user if questions arise

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2"] },
    { "wave": 2, "tasks": ["3"] },
    { "wave": 3, "tasks": ["4"] }
  ]
}
```

## Notes

- Tasks 1 and 2 MUST be completed before task 3. The exploration test (task 1) is expected to FAIL on unfixed code — that failure is the evidence the bug exists.
- The only file changed by this fix is `src/events/events.module.ts`. No gateway logic, event names, room names, or message payloads are modified.
- The `JwtModule.registerAsync` configuration must exactly mirror `AuthModule` to ensure consistent JWT secret and expiry handling across the application.
