import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { server } from './mocks/server';

// Start MSW server before all tests
beforeAll(() => server.listen({ onUnhandledRequest: 'warn' }));

// Reset handlers after each test to avoid inter-test pollution
afterEach(() => {
  server.resetHandlers();
  cleanup();
});

// Close MSW server after all tests
afterAll(() => server.close());

// A test must not end with a request still in flight. Vitest deletes jsdom's
// globals when the file's environment is torn down, and msw's XHR interceptor
// reads `ProgressEvent` at the moment a response arrives — so a late response
// throws a ReferenceError with no one left to catch it, and the run fails with
// an unhandled rejection blamed on whichever file was running at the time.
// Hold a response open with a promise you resolve, and await what it produces.
