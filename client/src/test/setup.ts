import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

/**
 * @testing-library/react only auto-cleans when the test runner exposes a global
 * `afterEach`. Vitest does not without `globals: true`, and this config does not
 * enable it - so without this the rendered DOM accumulates across tests in a
 * file and every `getBy*` after the first render reports multiple matches.
 */
afterEach(() => {
  cleanup();
});