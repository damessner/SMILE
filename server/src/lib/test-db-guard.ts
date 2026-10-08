import pg from 'pg';

export interface ValidatedTestDbTarget {
  database: string;
  host: string;
  port: number;
  user: string;
}

export type IntegrationTestMode =
  | { run: true; url: string }
  | { run: false; reason: 'explicit local opt-out' };

/**
 * Decide whether the destructive PostgreSQL suite may run. Missing configuration
 * is an error unless a local developer explicitly opts out; CI can never opt out.
 */
export function getIntegrationTestMode(options: {
  testDatabaseUrl?: string | null;
  skipRequested: boolean;
  ci: boolean;
}): IntegrationTestMode {
  const url = options.testDatabaseUrl?.trim() || null;

  if (options.ci && options.skipRequested) {
    throw new Error('CI cannot skip PostgreSQL integration tests.');
  }
  if (url && options.skipRequested) {
    throw new Error('SKIP_POSTGRES_INTEGRATION cannot be combined with TEST_DATABASE_URL.');
  }
  if (!url) {
    if (options.skipRequested && !options.ci) {
      return { run: false, reason: 'explicit local opt-out' };
    }
    throw new Error(
      'TEST_DATABASE_URL is required unless SKIP_POSTGRES_INTEGRATION=true is explicitly set for a local run.'
    );
  }

  validateTestDatabaseUrl(url);
  return { run: true, url };
}

/**
 * Validates that a connection string points strictly to the dedicated test database
 * ('smile_db_test') without exposing or logging credentials.
 */
export function validateTestDatabaseUrl(urlStr: string | null | undefined): ValidatedTestDbTarget {
  if (!urlStr || typeof urlStr !== 'string' || !urlStr.trim()) {
    throw new Error('TEST_DATABASE_URL is required but was empty or undefined.');
  }

  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error('TEST_DATABASE_URL is not a valid URL.');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error(`TEST_DATABASE_URL must use postgres: or postgresql: protocol, got '${parsed.protocol}'`);
  }

  // node-postgres lets query-string parameters override URL fields (notably
  // `host`), so validating only URL.hostname/pathname and then passing the raw
  // string to Client would leave the actual connection target unpinned.
  if (parsed.search || parsed.hash) {
    throw new Error('TEST_DATABASE_URL must not contain query parameters or fragments.');
  }

  if (!parsed.username) {
    throw new Error('TEST_DATABASE_URL must specify a dedicated test role.');
  }

  const dbName = parsed.pathname.replace(/^\//, '');
  if (dbName !== 'smile_db_test') {
    throw new Error(
      `Integration tests must run strictly against 'smile_db_test'. Refusing target database: '${dbName || '(empty)'}'.`
    );
  }

  let user: string;
  try {
    user = decodeURIComponent(parsed.username);
  } catch {
    throw new Error('TEST_DATABASE_URL contains invalid encoding in the test role name.');
  }
  if (!user || /[\u0000-\u001f\u007f]/.test(user)) {
    throw new Error('TEST_DATABASE_URL must specify a valid dedicated test role.');
  }
  const parsedHost = parsed.hostname.toLowerCase() || 'localhost';
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(parsedHost)) {
    throw new Error('TEST_DATABASE_URL must target a loopback host for an isolated integration database.');
  }
  // Pin DNS-based localhost to IPv4 loopback and strip URL syntax brackets from
  // IPv6 before handing the host to node-postgres.
  const host = parsedHost === 'localhost' ? '127.0.0.1' : parsedHost === '[::1]' ? '::1' : parsedHost;
  const port = parsed.port ? parseInt(parsed.port, 10) : 5432;
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('TEST_DATABASE_URL must specify a valid PostgreSQL port.');
  }

  return { database: dbName, host, port, user };
}

/** Build explicit node-postgres fields from the already-restricted test URL. */
export function createTestDatabaseClientConfig(url: string): pg.ClientConfig {
  const target = validateTestDatabaseUrl(url);
  const parsed = new URL(url);
  let password: string;
  try {
    password = decodeURIComponent(parsed.password);
  } catch {
    throw new Error('TEST_DATABASE_URL contains invalid encoding in the password.');
  }

  return {
    host: target.host,
    port: target.port,
    database: target.database,
    user: target.user,
    password,
    ssl: false,
    options: '-c search_path=public',
    connectionTimeoutMillis: 2000,
  };
}

/** Probe a candidate target, always closing the socket even when validation fails. */
export async function probeTestDatabaseConnection(
  url: string,
  createClient: (config: pg.ClientConfig) => pg.Client = (config) => new pg.Client(config),
): Promise<void> {
  // Do not pass the raw URL to node-postgres. Explicit fields prevent connection
  // string parameters or PG* environment defaults from changing the validated host,
  // database, port, or role after our preflight check. The same fields configure
  // the migration/cleanup pool via createTestDatabaseClientConfig.
  const config = createTestDatabaseClientConfig(url);
  const client = createClient(config);
  try {
    await client.connect();
    await verifyTestDatabaseConnection(client, config.user as string);
    await client.query('SELECT 1');
  } finally {
    // end() is best-effort if connect/query itself failed; preserve the useful
    // validation/connection error rather than masking it with cleanup failure.
    try {
      await client.end();
    } catch {
      // The client may never have connected.
    }
  }
}

/**
 * Verifies live PostgreSQL session state: confirms current_database() is 'smile_db_test'
 * and current_user is not a superuser (requiring a least-privilege test role).
 */
export async function verifyTestDatabaseConnection(
  client: Pick<pg.Client, 'query'>,
  expectedLoginUser: string,
  options: { requireEmpty?: boolean } = {},
): Promise<void> {
  const result = await client.query<{
    db: string;
    login_user: string;
    usr: string;
    is_super: boolean;
    can_create_db: boolean;
    can_create_role: boolean;
    can_replicate: boolean;
    can_bypass_rls: boolean;
    can_create_in_db: boolean;
    has_user_objects: boolean;
    has_role_memberships: boolean;
  }>(
    `SELECT current_database() AS db,
            session_user AS login_user,
            current_user AS usr,
            r.rolsuper AS is_super,
            r.rolcreatedb AS can_create_db,
            r.rolcreaterole AS can_create_role,
            r.rolreplication AS can_replicate,
            r.rolbypassrls AS can_bypass_rls,
            has_database_privilege(current_user, current_database(), 'CREATE') AS can_create_in_db,
            (
              EXISTS (
                SELECT 1
                  FROM pg_class c
                  JOIN pg_namespace n ON n.oid = c.relnamespace
                 WHERE n.nspname <> 'information_schema'
                   AND n.nspname !~ '^pg_'
                    AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f', 'c')
              ) OR EXISTS (
                SELECT 1
                  FROM pg_namespace n
                 WHERE n.nspname <> 'public'
                   AND n.nspname <> 'information_schema'
                   AND n.nspname !~ '^pg_'
              ) OR EXISTS (
                SELECT 1
                  FROM pg_proc p
                  JOIN pg_namespace n ON n.oid = p.pronamespace
                 WHERE n.nspname = 'public'
              ) OR EXISTS (
                SELECT 1
                  FROM pg_type t
                  JOIN pg_namespace n ON n.oid = t.typnamespace
                 WHERE n.nspname = 'public'
                   AND t.typtype <> 'p'
                   AND t.typname !~ '^_'
              ) OR EXISTS (
                SELECT 1 FROM pg_largeobject_metadata
              )
            ) AS has_user_objects,
            EXISTS (
                SELECT 1
                  FROM pg_auth_members m
                 WHERE m.member = (
                   SELECT r.oid FROM pg_roles r WHERE r.rolname = current_user
                 )
            ) AS has_role_memberships
       FROM pg_roles r
      WHERE r.rolname = current_user`
  );

  if (result.rows.length === 0) {
    throw new Error('Failed to verify PostgreSQL database identity.');
  }

  const {
    db,
    login_user,
    usr,
    is_super,
    can_create_db,
    can_create_role,
    can_replicate,
    can_bypass_rls,
    can_create_in_db,
    has_user_objects,
    has_role_memberships,
  } = result.rows[0];
  if (db !== 'smile_db_test') {
    throw new Error(
      `Safety check failed: connected database is '${db}', expected 'smile_db_test'. Aborting immediately.`
    );
  }

  if (login_user !== expectedLoginUser) {
    throw new Error(
      'Safety check failed: authenticated role does not match the validated test role.'
    );
  }

  if (login_user !== usr) {
    throw new Error(
      'Safety check failed: authenticated login role must match the verified current user.'
    );
  }

  if (is_super || can_create_db || can_create_role || can_replicate || can_bypass_rls) {
    throw new Error(
      `Safety check failed: connected user '${usr}' has cluster-wide privileges. Dedicated least-privilege test role required.`
    );
  }

  if (has_role_memberships) {
    throw new Error(
      `Safety check failed: connected user '${usr}' must not inherit privileges from other database roles.`
    );
  }

  if (!can_create_in_db) {
    throw new Error(
      `Safety check failed: connected user '${usr}' cannot create the isolated test schema in '${db}'. Grant only the required privileges on the test database.`
    );
  }

  if (options.requireEmpty !== false && has_user_objects) {
    throw new Error(
      'Safety check failed: test database must be empty before integration tests. Create a fresh disposable smile_db_test database.'
    );
  }
}
