import { describe, expect, it } from 'vitest';
import { findStrayBackups } from '../verify-env.mjs';
import path from 'path';
import fs from 'fs';
import os from 'os';

describe('verify-env backup detection', () => {
  it('finds matching archives below four nested directories', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smile-guard-depth-test-'));
    try {
      const deepDir = path.join(tmpDir, 'one', 'two', 'three', 'four', 'five');
      fs.mkdirSync(deepDir, { recursive: true });
      fs.writeFileSync(path.join(deepDir, 'backup-deep.zip'), 'synthetic test data');

      expect(findStrayBackups(tmpDir).map((entry) => path.basename(entry.path)))
        .toContain('backup-deep.zip');
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('finds all documented backup names and dump extensions without touching the workspace', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'smile-guard-test-'));
    try {
      const expectedArchives = [
        'backup.zip',
        'backup_date_time.zip',
        'backup_2026-10-01_17-39-50.zip',
      ];
      for (const name of expectedArchives) fs.writeFileSync(path.join(tmpDir, name), 'dummy');
      fs.writeFileSync(path.join(tmpDir, 'database.dump'), 'dummy');
      fs.writeFileSync(path.join(tmpDir, 'schema_export.sql.gz'), 'dummy');
      fs.writeFileSync(path.join(tmpDir, 'regular_code.ts'), 'console.log("ok");');
      fs.writeFileSync(path.join(tmpDir, 'fixture.dump'), 'dummy');

      const found = findStrayBackups(tmpDir, new Set(['fixture.dump']));
      const baseNames = found.map((f) => path.basename(f.path));

      for (const name of expectedArchives) expect(baseNames).toContain(name);
      expect(baseNames).toContain('database.dump');
      expect(baseNames).toContain('schema_export.sql.gz');
      expect(baseNames).not.toContain('regular_code.ts');
      expect(baseNames).not.toContain('fixture.dump'); // Excluded as fixture
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
