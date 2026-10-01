import { defineConfig } from 'drizzle-kit';
import dotenv from 'dotenv';
import path from 'path';

// Self-contained on purpose: drizzle-kit loads this file with CommonJS `require`,
// so it cannot use `import.meta.url` or import from ./src (NodeNext .js -> .ts mapping).
const serverRoot = process.cwd();
dotenv.config({ path: path.resolve(serverRoot, '../.env') });

const url = process.env.DATABASE_URL?.trim();
if (!url) {
  throw new Error(
    'DATABASE_URL is not set. Copy .env.example to .env first. ' +
      'There is deliberately no fallback: the old hardcoded fallback leaked the production password.',
  );
}

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url },
  migrations: {
    table: '__drizzle_migrations',
    schema: 'public',
  },
  verbose: true,
  strict: true,
});