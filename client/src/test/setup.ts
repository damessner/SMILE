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

/**
 * Deterministic Web Storage for every test file.
 *
 * Why this is installed rather than relied upon:
 * Node 23+ defines `localStorage` and `sessionStorage` on `globalThis` as
 * experimental WebStorage accessors. Without `--localstorage-file` they evaluate
 * to `undefined` (and print an ExperimentalWarning). Vitest's jsdom environment
 * copies the jsdom window onto the global object but deliberately skips names that
 * already exist there, so the real jsdom Storage never becomes reachable and
 * `window.localStorage` resolves to the same undefined accessor.
 *
 * Result before this shim: the whole App.test.tsx suite failed on Node 23+ with
 * "Cannot read properties of undefined (reading 'setItem')" while the same code
 * passed on Node 22 in CI. The application only needs the documented Storage
 * contract, so the runner's Node version must not decide whether storage exists.
 *
 * The map is recreated for every test file (setup files run once per file), which
 * also gives each file an empty store instead of sharing whatever a previous file
 * left behind. Components still guard against storage being unavailable at
 * runtime (private browsing / disabled storage); this only replaces the harness.
 */
function installMemoryStorage(name: 'localStorage' | 'sessionStorage'): void {
  const entries = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return entries.size;
    },
    clear() {
      entries.clear();
    },
    getItem(key: string) {
      const normalized = String(key);
      return entries.has(normalized) ? (entries.get(normalized) as string) : null;
    },
    key(index: number) {
      return Array.from(entries.keys())[index] ?? null;
    },
    removeItem(key: string) {
      entries.delete(String(key));
    },
    setItem(key: string, value: string) {
      entries.set(String(key), String(value));
    },
  };

  Object.defineProperty(globalThis, name, {
    value: storage,
    configurable: true,
    writable: true,
  });
}

installMemoryStorage('localStorage');
installMemoryStorage('sessionStorage');
