import { defineConfig } from 'vitest/config';

/** Revisão das personas com o modelo real (npm run personas:review). Fora do npm test. */
export default defineConfig({
  test: {
    include: ['tests/review/**/*.review.ts'],
    environment: 'node',
    testTimeout: 600_000,
  },
});
