# Events Module JWT Injection Bugfix Design

## Overview

`EventsGateway` injects `JwtService` (constructor index 0) and `PrismaService` (constructor index 1).
`PrismaModule` is decorated `@Global()`, so `PrismaService` is available application-wide without an explicit import.
`JwtModule` is NOT global and is not imported in `EventsModule`, which causes NestJS to throw
`UnknownDependenciesException` at bootstrap and prevents the application from starting.

The fix is minimal: import `JwtModule.registerAsync` (using the same `ConfigService`-based pattern as
`AuthModule`) into `EventsModule`. No logic changes to `EventsGateway` are required.

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — `EventsModule` does not import `JwtModule`, making `JwtService` unresolvable by the NestJS DI container.
- **Property (P)**: The desired behavior when the application boots — all `EventsGateway` dependencies are resolved and the application starts without exceptions.
- **Preservation**: Existing WebSocket authentication, room management, notification dispatch, and message routing behaviour that must remain unchanged after the fix.
- **EventsGateway**: The class in `src/events/events.gateway.ts` that handles WebSocket connections, JWT authentication, and real-time messaging.
- **EventsModule**: The NestJS module in `src/events/events.module.ts` that declares and exports `EventsGateway`.
- **JwtModule**: The `@nestjs/jwt` module that provides `JwtService`. Must be imported (with configuration) into any module whose providers need `JwtService`.
- **UnknownDependenciesException**: The NestJS error thrown at bootstrap when a required provider cannot be found in the current module context.

## Bug Details

### Bug Condition

The bug manifests when the NestJS application boots and the DI container attempts to instantiate
`EventsGateway`. Because `JwtModule` is not listed in the `imports` array of `EventsModule`,
`JwtService` is not available in that module's provider context.

**Formal Specification:**
```
FUNCTION isBugCondition(module)
  INPUT: module of type NestJS ModuleMetadata
  OUTPUT: boolean

  RETURN module.name = 'EventsModule'
         AND 'JwtModule' NOT IN module.imports
         AND 'JwtService' IN constructorDependencies(module.providers['EventsGateway'])
END FUNCTION
```

### Examples

- **Boot attempt**: Application starts → NestJS resolves `EventsModule` → tries to inject `JwtService` at index [0] of `EventsGateway` → `JwtModule` not found in `EventsModule` imports → `UnknownDependenciesException` thrown → application crashes.
- **Expected after fix**: Application starts → NestJS resolves `EventsModule` (now imports `JwtModule.registerAsync`) → `JwtService` injected successfully → `PrismaService` injected from global context → `EventsGateway` instantiated → application starts.
- **Edge case — missing ConfigService**: If `ConfigModule` is not imported alongside `JwtModule.registerAsync`, the factory cannot resolve `ConfigService`. Mitigated by importing `ConfigModule` in the `registerAsync` call (same pattern as `AuthModule`).
- **Edge case — wrong secret**: If the `JWT_SECRET` environment variable is absent, `jwtService.verifyAsync` will use `'default_secret'` (matching `AuthModule`'s fallback). No change to this behaviour.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- WebSocket clients connecting with a valid JWT token must continue to be authenticated, with `client.userId` and `client.role` populated and the socket added to `user_<id>` and/or `admins` rooms.
- WebSocket clients connecting without a token or with an invalid token must continue to be disconnected immediately.
- Socket cleanup on disconnect must continue to remove the socket ID from `userSockets` and delete the user entry when no sockets remain.
- `sendNotification`, `sendToAdmins`, `notifyNewOrder`, and `notifyOrderPaid` must continue to emit the correct events to the correct Socket.IO rooms.
- The `sendMessage` handler must continue to route messages to the intended recipient and echo them to the sender.

**Scope:**
All runtime behaviour of `EventsGateway` is unaffected by this fix. The only change is the addition of `JwtModule` to `EventsModule`'s `imports` array. No gateway logic, no event names, no room names, and no message payloads change.

## Hypothesized Root Cause

Based on the bug description and code inspection, the single root cause is:

1. **Missing JwtModule import in EventsModule**: `EventsModule` declares `EventsGateway` as a provider but has no `imports` array. `JwtModule` is not a global module, so `JwtService` is not available in `EventsModule`'s DI context.
   - `AuthModule` correctly imports `JwtModule.registerAsync` and exports `JwtModule`, but `EventsModule` does not import `AuthModule` either.
   - `PrismaModule` is `@Global()`, which is why `PrismaService` resolves correctly despite not being explicitly imported.

No other root causes are plausible: the gateway code itself is correct; the JWT verification logic, room management, and message handlers all function as intended once the dependency is available.

## Correctness Properties

Property 1: Bug Condition - Application Boots Without DI Exception

_For any_ NestJS application bootstrap where `EventsModule` is registered, the fixed `EventsModule`
(which imports `JwtModule.registerAsync` with `ConfigService`) SHALL allow the DI container to resolve
`JwtService` at `EventsGateway` constructor index [0] without throwing `UnknownDependenciesException`,
enabling the application to start successfully.

**Validates: Requirements 2.1, 2.2**

Property 2: Preservation - WebSocket Runtime Behaviour Unchanged

_For any_ WebSocket interaction (connection with valid token, connection with invalid/missing token,
disconnection, notification dispatch, message routing) that does NOT involve the DI bootstrap phase,
the fixed `EventsModule` SHALL produce exactly the same runtime behaviour as the original `EventsGateway`
implementation, preserving all authentication, room management, and messaging logic.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

**File**: `src/events/events.module.ts`

**Specific Changes**:
1. **Add imports array**: Introduce an `imports` array to `@Module()` decorator.
2. **Import ConfigModule**: Add `ConfigModule` so the `JwtModule.registerAsync` factory can inject `ConfigService`.
3. **Import JwtModule.registerAsync**: Mirror the exact configuration used in `AuthModule` — inject `ConfigService`, read `JWT_SECRET` and `JWT_EXPIRES_IN` from environment, with the same fallback values (`'default_secret'` and `'1h'`).
4. **No other changes**: `EventsGateway`, its constructor, and all handler methods remain untouched.

**Before:**
```typescript
@Module({
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
```

**After:**
```typescript
@Module({
  imports: [
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'default_secret',
        signOptions: {
          expiresIn: (configService.get<string>('JWT_EXPIRES_IN') || '1h') as any,
        },
      }),
    }),
  ],
  providers: [EventsGateway],
  exports: [EventsGateway],
})
export class EventsModule {}
```

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface the `UnknownDependenciesException`
by attempting to create the module without the fix (exploratory), then verify the fix resolves the
exception and preserves all gateway behaviour.

### Exploratory Bug Condition Checking

**Goal**: Surface the `UnknownDependenciesException` that demonstrates the bug BEFORE implementing
the fix. Confirm the root cause analysis.

**Test Plan**: Write a NestJS testing module that creates `EventsModule` without importing `JwtModule`
and assert that bootstrap throws `UnknownDependenciesException`. Run on UNFIXED code.

**Test Cases**:
1. **Bootstrap without JwtModule**: Create `EventsModule` in a test harness without `JwtModule` in imports — expect `UnknownDependenciesException` at index [0] (will fail/throw on unfixed code, demonstrating the bug).
2. **Direct injection check**: Attempt to resolve `EventsGateway` from the test module — expect it to throw because `JwtService` is missing.

**Expected Counterexamples**:
- `Nest can't resolve dependencies of the EventsGateway (?, PrismaService). Please make sure that the argument JwtService at index [0] is available in the EventsModule context.`
- Possible causes: `JwtModule` not imported, `AuthModule` not imported, `JwtService` not globally provided.

### Fix Checking

**Goal**: Verify that after the fix, the application module containing `EventsModule` boots without any DI exception.

**Pseudocode:**
```
FOR ALL moduleConfig WHERE isBugCondition(moduleConfig) DO
  result := bootstrapModule(moduleConfig_fixed)
  ASSERT result.exceptionThrown = false
  ASSERT result.eventsGateway instanceof EventsGateway
  ASSERT result.jwtService instanceof JwtService
END FOR
```

### Preservation Checking

**Goal**: Verify that for all WebSocket interactions where the bug condition does NOT hold (i.e., runtime behaviour after a successful boot), the fixed code behaves identically to the original gateway logic.

**Pseudocode:**
```
FOR ALL socketEvent WHERE NOT isBugCondition(moduleConfig) DO
  ASSERT handleEvent_original(socketEvent) = handleEvent_fixed(socketEvent)
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many random token/payload combinations to verify authentication logic.
- It catches edge cases in room assignment (e.g., users with no roles, users with ADMIN role).
- It provides strong guarantees that no gateway handler was inadvertently changed.

**Test Plan**: Observe gateway behaviour on correctly-booted (but logically unfixed) code first, then write property-based tests capturing that behaviour.

**Test Cases**:
1. **Valid token connection preservation**: Verify that a socket connecting with a valid JWT is authenticated, assigned `userId`/`role`, and joined to the correct rooms.
2. **Invalid token disconnection preservation**: Verify that a socket connecting with an invalid or missing token is immediately disconnected.
3. **Disconnect cleanup preservation**: Verify that `handleDisconnect` removes the socket from `userSockets` and deletes empty user entries.
4. **Notification dispatch preservation**: Verify `sendNotification` and `sendToAdmins` emit to the correct Socket.IO rooms.
5. **Message routing preservation**: Verify `sendMessage` routes to recipient, echoes to sender, and notifies admins for non-admin senders.

### Unit Tests

- Test that `EventsModule` can be created without throwing when `JwtModule` is imported.
- Test `handleConnection` with a mock `JwtService` that returns a valid payload.
- Test `handleConnection` with a mock `JwtService` that throws (invalid token path).
- Test `handleDisconnect` removes socket from `userSockets` correctly.
- Test that `sendNotification` calls `server.to(...).emit(...)` with correct arguments.

### Property-Based Tests

- Generate random valid JWT payloads and verify `handleConnection` always populates `userId` and joins the correct room.
- Generate random `userId` values and verify `sendNotification` always targets `user_<userId>` room.
- Generate random non-number-key socket events and verify no gateway state changes occur unexpectedly.

### Integration Tests

- Full application bootstrap test: start the NestJS app including `EventsModule` and assert no exceptions are thrown.
- WebSocket client integration: connect a test client with a valid token, verify it joins the correct room, then disconnect and verify cleanup.
- Notification flow: trigger `notifyNewOrder` and verify the test client in the `admins` room receives the event.
