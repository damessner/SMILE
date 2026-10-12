#!/usr/bin/env node
/**
 * Post-install guard.
 *
 * The pre-hardening repository shipped a live `.env` containing the production
 * database password and JWT signing secret, with no `.gitignore`. This script refuses
 * to let that recur by checking the working tree after every install.
 *
 * It warns loudly and exits non-zero so a developer install fails rather than
 * continuing with a leaked secret on disk.
 *
 * IMPORTANT: this never runs in production. On the deployed LXC, `/opt/smile/.env`
 * legitimately exists and holds rotated secrets, so a non-zero exit here would abort
 * `npm install` and take the school system down. It is a developer-workstation guard
 * only; the production equivalent is the rotation procedure in docs/SECURITY.md.
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'fs';
import { join, dirname, relative } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const BACKUP_PATTERNS = [
  /^backup.*\.zip$/i,
  /\.dump$/i,
  /\.sql\.gz$/i,
];

/**
 * Scan directory recursively for backup archives and database dumps while excluding
 * build artifacts, version control dirs, and documented test fixtures.
 * Never inspects or prints file contents.
 */
export function findStrayBackups(scanDir, fixturePaths = new Set()) {
  const strayFiles = [];

  function scan(dir) {
    let entries = [];
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relPath = relative(scanDir, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (
          entry.name === 'node_modules' ||
          entry.name === '.git' ||
          entry.name === 'dist' ||
          entry.name === '.vitest'
        ) {
          continue;
        }
        scan(fullPath);
      } else if (entry.isFile()) {
        if (fixturePaths.has(relPath) || fixturePaths.has(entry.name)) {
          continue;
        }
        for (const pattern of BACKUP_PATTERNS) {
          if (pattern.test(entry.name)) {
            const kb = Math.round(statSync(fullPath).size / 1024);
            strayFiles.push({ path: relPath, sizeKb: kb });
            break;
          }
        }
      }
    }
  }

  scan(scanDir);
  return strayFiles;
}

export function checkEnvironment(rootDir = root, env = process.env) {
  // Production / CI skip
  if (
    env.NODE_ENV === 'production' ||
    env.CI === 'true' ||
    existsSync('/opt/smile')
  ) {
    return { skipped: true, problems: [] };
  }

  const problems = [];

  // 1. .env must not be readable by git.
  const gitignore = join(rootDir, '.gitignore');
  if (!existsSync(gitignore)) {
    problems.push('No .gitignore found — .env could be committed.');
  } else {
    const gi = readFileSync(gitignore, 'utf8');
    if (!/^\.env\s*$/m.test(gi)) {
      problems.push('.gitignore does not ignore .env.');
    }
  }

  // 2. A .env on disk must not contain the values that were previously leaked.
  const envPath = join(rootDir, '.env');
  const LEAKED = [
    'smile_super_secret_jwt_key_2026_telfs_weissenbach!',
    'smile_secure_pass_2026!',
  ];

  if (existsSync(envPath)) {
    const envContent = readFileSync(envPath, 'utf8');
    for (const secret of LEAKED) {
      if (envContent.includes(secret)) {
        problems.push(
          `.env still contains a previously leaked secret. Rotate it and update the file.`,
        );
      }
    }
    if (!/^JWT_SECRET=.+/m.test(envContent)) {
      problems.push('.env has no JWT_SECRET. The server will refuse to start without it.');
    }
    if (!/^DATABASE_URL=.+/m.test(envContent)) {
      problems.push('.env has no DATABASE_URL.');
    }
  }

  // 3. Backup archives contain the full pupil database and must not live in the tree.
  const strayBackups = findStrayBackups(rootDir);
  for (const b of strayBackups) {
    problems.push(
      `${b.path} (${b.sizeKb} KB) is in the working tree. It contains pupil data — move it to controlled storage.`,
    );
  }

  return { skipped: false, problems };
}

// Direct execution guard
if (process.argv[1] && process.argv[1].endsWith('verify-env.mjs')) {
  const result = checkEnvironment(root);
  if (result.skipped) {
    console.log('[verify-env] skipped (production environment)');
    process.exit(0);
  }

  if (result.problems.length > 0) {
    console.error('\n[verify-env] Problems found:\n');
    for (const p of result.problems) console.error(`  - ${p}`);
    console.error('\nSee docs/SECURITY.md.\n');
    process.exit(1);
  }

  console.log('[verify-env] OK — no leaked secrets or stray backups detected.');
}
