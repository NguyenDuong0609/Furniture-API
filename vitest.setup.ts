import 'dotenv/config';

// Load .env.test for integration tests
if (process.env.NODE_ENV === 'test' || process.env.BENCH) {
  // Vitest loads .env automatically, but we can override here if needed
  // The dotenv-cli package in npm scripts handles loading .env.test
}
