import { defineConfig } from 'vitest/config';

// Unit tests are headless (engine, contracts, pure UI models). They never start the IWSDK dev server.
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
