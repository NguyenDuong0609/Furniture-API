# Bugfix Requirements Document

## Introduction

The NestJS application fails to start due to an `UnknownDependenciesException`. `EventsGateway` declares two constructor dependencies — `JwtService` (index 0) and `PrismaService` (index 1) — but `EventsModule` only registers `EventsGateway` as a provider. Because `JwtModule` is never imported into `EventsModule`, NestJS cannot resolve `JwtService` during the dependency injection bootstrap phase, preventing the entire application from starting.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the NestJS application boots and resolves `EventsModule` THEN the system throws `UnknownDependenciesException: Nest can't resolve dependencies of the EventsGateway (?, PrismaService)` and the application fails to start.

1.2 WHEN `EventsGateway` is instantiated by the NestJS DI container THEN the system cannot inject `JwtService` at constructor index [0] because `JwtModule` is not imported in `EventsModule`.

### Expected Behavior (Correct)

2.1 WHEN the NestJS application boots and resolves `EventsModule` THEN the system SHALL successfully resolve all `EventsGateway` constructor dependencies (`JwtService` and `PrismaService`) without throwing any exception.

2.2 WHEN `EventsGateway` is instantiated by the NestJS DI container THEN the system SHALL inject a valid `JwtService` instance at constructor index [0] by importing `JwtModule` (with its configuration) into `EventsModule`.

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a WebSocket client connects with a valid JWT token THEN the system SHALL CONTINUE TO authenticate the socket, populate `client.userId` and `client.role`, and add the socket to the appropriate rooms (`user_<id>` and/or `admins`).

3.2 WHEN a WebSocket client connects without a token or with an invalid token THEN the system SHALL CONTINUE TO disconnect the client immediately.

3.3 WHEN a WebSocket client disconnects THEN the system SHALL CONTINUE TO remove the socket from `userSockets` and clean up empty user entries.

3.4 WHEN `sendNotification`, `sendToAdmins`, `notifyNewOrder`, or `notifyOrderPaid` are called THEN the system SHALL CONTINUE TO emit the correct events to the correct Socket.IO rooms.

3.5 WHEN a connected client sends a `sendMessage` event THEN the system SHALL CONTINUE TO route the message to the intended recipient and echo it back to the sender.
