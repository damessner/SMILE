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
import { readFileSync, existsSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

// Production: never fail an install. Detected three ways because the LXC runs with
// NODE_ENV=production, CI systems set CI, and the container path is unambiguous.
if (
  process.env.NODE_ENV === 'production' ||
  process.env.CI === 'true' ||
  existsSync('/opt/smile')
) {
  console.log('[verify-env] skipped (production environment)');
  process.exit(0);
}

const problems = [];

// 1. .env must not be readable by git.
const gitignore = join(root, '.gitignore');
if (!existsSync(gitignore)) {
  problems.push('No .gitignore found — .env could be committed.');
} else {
  const gi = readFileSync(gitignore, 'utf8');
  if (!/^\.env\s*$/m.test(gi)) {
    problems.push('.gitignore does not ignore .env.');
  }
}

// 2. A .env on disk must not contain the values that were previously leaked.
const envPath = join(root, '.env');
const LEAKED = [
  'smile_super_secret_jwt_key_2026_telfs_weissenbach!',
  'smile_secure_pass_2026!',
];

if (existsSync(envPath)) {
  const env = readFileSync(envPath, 'utf8');
  for (const secret of LEAKED) {
    if (env.includes(secret)) {
      problems.push(
        `.env still contains a previously leaked secret. Rotate it and update the file.`,
      );
    }
  }
  if (!/^JWT_SECRET=.+/m.test(env)) {
    problems.push('.env has no JWT_SECRET. The server will refuse to start without it.');
  }
  if (!/^DATABASE_URL=.+/m.test(env)) {
    problems.push('.env has no DATABASE_URL.');
  }
} else {
  console.log('info: no .env present. Copy .env.example and fill it in before starting the server.');
}

// 3. Backup archives contain the full pupil database and must not live in the tree.
for (const name of ['backup_date_time.zip', 'backup_2026-10-01_17-39-50.zip']) {
  const p = join(root, name);
  if (existsSync(p)) {
    const kb = Math.round(statSync(p).size / 1024);
    problems.push(
      `${name} (${kb} KB) is in the working tree. It contains pupil data — move it to controlled storage.`,
    );
  }
}

if (problems.length > 0) {
  console.error('\n[verify-env] Problems found:\n');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nSee docs/SECURITY.md.\n');
  process.exit(1);
}

console.log('[verify-env] OK — no leaked secrets or stray backups detected.');