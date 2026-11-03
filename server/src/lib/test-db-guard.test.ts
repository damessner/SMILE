import { describe, expect, it, vi } from 'vitest';
import {
  getIntegrationTestMode,
  probeTestDatabaseConnection,
  validateTestDatabaseUrl,
  verifyTestDatabaseConnection,
} from './test-db-guard.js';

describe('getIntegrationTestMode', () => {
  it('requires an explicit local opt-out instead of silently skipping PostgreSQL tests', () => {
    expect(() => getIntegrationTestMode({ ci: false, skipRequested: false, testDatabaseUrl: undefined }))
      .toThrow('TEST_DATABASE_URL is required unless SKIP_POSTGRES_INTEGRATION=true');
  });

  it('allows only an explicit local opt-out and never permits CI to skip', () => {
    expect(getIntegrationTestMode({ ci: false, skipRequested: true, testDatabaseUrl: undefined }))
      .toEqual({ run: false, reason: 'explicit local opt-out' });
    expect(() => getIntegrationTestMode({ ci: true, skipRequested: true, testDatabaseUrl: undefined }))
      .toThrow('CI cannot skip PostgreSQL integration tests');
  });

  it('runs only when an explicit test URL names the dedicated database', () => {
    expect(getIntegrationTestMode({
      ci: false,
      skipRequested: false,
      testDatabaseUrl: 'postgresql://smile_test:secret@localhost:5432/smile_db_test',
    })).toEqual({
      run: true,
      url: 'postgresql://smile_test:secret@localhost:5432/smile_db_test',
    });
    expect(() => getIntegrationTestMode({
      ci: false,
      skipRequested: false,
      testDatabaseUrl: 'postgresql://smile_test:secret@localhost:5432/smile_db',
    })).toThrow("Refusing target database: 'smile_db'");
    expect(() => getIntegrationTestMode({
      ci: false,
      skipRequested: true,
      testDatabaseUrl: 'postgresql://smile_test:secret@localhost:5432/smile_db_test',
    })).toThrow('cannot be combined with TEST_DATABASE_URL');
  });
});

describe('validateTestDatabaseUrl', () => {
  it('throws on empty or null URL', () => {
    expect(() => validateTestDatabaseUrl(null)).toThrow('TEST_DATABASE_URL is required');
    expect(() => validateTestDatabaseUrl('')).toThrow('TEST_DATABASE_URL is required');
    expect(() => validateTestDatabaseUrl(undefined)).toThrow('TEST_DATABASE_URL is required');
  });

  it('rejects a non-test database name before connecting', () => {
    expect(() =>
      validateTestDatabaseUrl('postgresql://user:pass@localhost:5432/smile_db')
    ).toThrow("Refusing target database: 'smile_db'");

    expect(() =>
      validateTestDatabaseUrl('postgresql://user:pass@localhost:5432/postgres')
    ).toThrow("Refusing target database: 'postgres'");

    expect(() =>
      validateTestDatabaseUrl('postgresql://user:pass@localhost:5432/production')
    ).toThrow("Refusing target database: 'production'");

    expect(() =>
      validateTestDatabaseUrl('postgresql://user:pass@localhost:5432/')
    ).toThrow("Refusing target database: '(empty)'");
  });

  it('rejects non-postgres protocols', () => {
    expect(() =>
      validateTestDatabaseUrl('http://localhost:5432/smile_db_test')
    ).toThrow('must use postgres: or postgresql: protocol');
  });

  it('rejects non-loopback hosts before opening a connection', () => {
    expect(() =>
      validateTestDatabaseUrl('postgresql://smile_test:fake@db.internal:5432/smile_db_test')
    ).toThrow('must target a loopback host');
  });

  it('rejects connection-string overrides and fragments that bypass the validated URL target', () => {
    expect(() =>
      validateTestDatabaseUrl(
        'postgresql://smile_test:fake@localhost:5432/smile_db_test?host=prod.example'
      )
    ).toThrow('must not contain query parameters or fragments');

    expect(() =>
      validateTestDatabaseUrl('postgresql://smile_test:fake@localhost:5432/smile_db_test#production')
    ).toThrow('must not contain query parameters or fragments');
  });

  it('requires an explicit database role in the connection URL', () => {
    expect(() =>
      validateTestDatabaseUrl('postgresql://localhost:5432/smile_db_test')
    ).toThrow('must specify a dedicated test role');
  });

  it('accepts smile_db_test target and extracts target info without leaking password', () => {
    const target = validateTestDatabaseUrl(
      'postgresql://smile_user:secret123@localhost:5433/smile_db_test'
    );
    expect(target.database).toBe('smile_db_test');
    expect(target.host).toBe('127.0.0.1');
    expect(target.port).toBe(5433);
    expect(target.user).toBe('smile_user');
    // Ensure password is not present in output object
    expect((target as any).password).toBeUndefined();
  });

  it('normalizes IPv6 loopback without URL brackets before creating a local socket', () => {
    const target = validateTestDatabaseUrl('postgresql://smile_test:fake@[::1]:5432/smile_db_test');
    expect(target.host).toBe('::1');
  });

  it('rejects port zero before constructing a database client', () => {
    expect(() => validateTestDatabaseUrl('postgresql://smile_test:fake@localhost:0/smile_db_test'))
      .toThrow('valid PostgreSQL port');
  });

  it('builds explicit connection options for the migration pool from the validated target', async () => {
    const guard = await import('./test-db-guard.js');
    const createConfig = (guard as any).createTestDatabaseClientConfig;
    expect(createConfig).toBeTypeOf('function');

    const connection = createConfig(
      'postgresql://smile_test:synthetic%40pass@localhost:5544/smile_db_test',
    );

    expect(connection).toMatchObject({
      host: '127.0.0.1',
      port: 5544,
      database: 'smile_db_test',
      user: 'smile_test',
      ssl: false,
      options: '-c search_path=public',
    });
    expect(connection.password).toBeTypeOf('string');
    expect(connection.connectionString).toBeUndefined();
  });
});

describe('verifyTestDatabaseConnection', () => {
  it('throws if connected database is not smile_db_test', async () => {
    const mockClient = {
      query: async () => ({
        rows: [{
          db: 'smile_db',
          login_user: 'smile_user',
          usr: 'smile_user',
          is_super: false,
          can_create_db: false,
          can_create_role: false,
          can_replicate: false,
          can_bypass_rls: false,
          can_create_in_db: true,
          has_user_objects: false,
          has_role_memberships: false,
        }],
      }),
    };
    await expect(
      verifyTestDatabaseConnection(mockClient as any, 'smile_user')
    ).rejects.toThrow("connected database is 'smile_db', expected 'smile_db_test'");
  });

  it('throws if connected user is a superuser', async () => {
    const mockClient = {
      query: async () => ({
        rows: [{
          db: 'smile_db_test',
          login_user: 'postgres',
          usr: 'postgres',
          is_super: true,
          can_create_db: true,
          can_create_role: true,
          can_replicate: true,
          can_bypass_rls: true,
          can_create_in_db: true,
          has_user_objects: false,
          has_role_memberships: false,
        }],
      }),
    };
    await expect(
      verifyTestDatabaseConnection(mockClient as any, 'postgres')
    ).rejects.toThrow("connected user 'postgres' has cluster-wide privileges");
  });

  it('rejects a connection that changed roles after login', async () => {
    const mockClient = {
      query: async () => ({
        rows: [{
          db: 'smile_db_test',
          login_user: 'postgres',
          usr: 'smile_test',
          is_super: false,
          can_create_db: false,
          can_create_role: false,
          can_replicate: false,
          can_bypass_rls: false,
          can_create_in_db: true,
          has_user_objects: false,
          has_role_memberships: false,
        }],
      }),
    };
    await expect(
      verifyTestDatabaseConnection(mockClient as any, 'postgres')
    ).rejects.toThrow('login role must match the verified current user');
  });

  it('rejects test roles with cluster-wide privileges even when not superusers', async () => {
    const mockClient = {
      query: async () => ({
        rows: [{
          db: 'smile_db_test',
          login_user: 'smile_test',
          usr: 'smile_test',
          is_super: false,
          can_create_db: true,
          can_create_role: false,
          can_replicate: false,
          can_bypass_rls: false,
          can_create_in_db: true,
          has_user_objects: false,
          has_role_memberships: false,
        }],
      }),
    };
    await expect(
      verifyTestDatabaseConnection(mockClient as any, 'smile_test')
    ).rejects.toThrow('cluster-wide privileges');
  });

  it('rejects a test role that inherits privileges through another role', async () => {
    const mockClient = {
      query: async () => ({
        rows: [{
          db: 'smile_db_test',
          login_user: 'smile_test',
          usr: 'smile_test',
          is_super: false,
          can_create_db: false,
          can_create_role: false,
          can_replicate: false,
          can_bypass_rls: false,
          can_create_in_db: true,
          has_user_objects: false,
          has_role_memberships: true,
        }],
      }),
    };
    await expect(
      verifyTestDatabaseConnection(mockClient as any, 'smile_test')
    ).rejects.toThrow('must not inherit privileges from other database roles');
  });

  it('rejects a database that already has user objects before migrations or fixture cleanup', async () => {
    const mockClient = {
      query: async () => ({
        rows: [{
          db: 'smile_db_test',
          login_user: 'smile_test',
          usr: 'smile_test',
          is_super: false,
          can_create_db: false,
          can_create_role: false,
          can_replicate: false,
          can_bypass_rls: false,
          can_create_in_db: true,
          has_user_objects: true,
          has_role_memberships: false,
        }],
      }),
    };
    await expect(
      verifyTestDatabaseConnection(mockClient as any, 'smile_test')
    ).rejects.toThrow('must be empty before integration tests');
  });

  it('still verifies identity and privileges on the pinned pool before fixture cleanup', async () => {
    const mockClient = {
      query: async () => ({
        rows: [{
          db: 'smile_db_test',
          login_user: 'smile_test',
          usr: 'smile_test',
          is_super: false,
          can_create_db: false,
          can_create_role: false,
          can_replicate: false,
          can_bypass_rls: false,
          can_create_in_db: true,
          has_user_objects: true,
          has_role_memberships: false,
        }],
      }),
    };

    await expect(
      verifyTestDatabaseConnection(mockClient as any, 'smile_test', { requireEmpty: false }),
    ).resolves.toBeUndefined();
  });

  it('passes when connected to smile_db_test with least privilege role', async () => {
    const mockClient = {
      query: async () => ({
        rows: [{
          db: 'smile_db_test',
          login_user: 'smile_test',
          usr: 'smile_test',
          is_super: false,
          can_create_db: false,
          can_create_role: false,
          can_replicate: false,
          can_bypass_rls: false,
          can_create_in_db: true,
          has_user_objects: false,
          has_role_memberships: false,
        }],
      }),
    };
    await expect(
      verifyTestDatabaseConnection(mockClient as any, 'smile_test')
    ).resolves.toBeUndefined();
  });
});

describe('probeTestDatabaseConnection', () => {
  it('rejects a connected role that differs from the validated URL role', async () => {
    const client = {
      connect: async () => undefined,
      query: vi.fn().mockResolvedValue({
        rows: [{
          db: 'smile_db_test',
          login_user: 'different_test_role',
          usr: 'different_test_role',
          is_super: false,
          can_create_db: false,
          can_create_role: false,
          can_replicate: false,
          can_bypass_rls: false,
          can_create_in_db: true,
          has_user_objects: false,
          has_role_memberships: false,
        }],
      }),
      end: vi.fn(async () => undefined),
    };

    await expect(
      probeTestDatabaseConnection(
        'postgresql://smile_test:synthetic@localhost:5432/smile_db_test',
        () => client as any,
      ),
    ).rejects.toThrow('authenticated role does not match the validated test role');
    expect(client.query).toHaveBeenCalledTimes(1);
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it('constructs the probe client from the validated target fields, not the raw connection string', async () => {
    let clientConfig: unknown;
    const client = {
      connect: vi.fn(async () => undefined),
      query: vi.fn()
        .mockResolvedValueOnce({
          rows: [{
            db: 'smile_db_test',
            login_user: 'smile_test',
            usr: 'smile_test',
            is_super: false,
            can_create_db: false,
            can_create_role: false,
            can_replicate: false,
            can_bypass_rls: false,
            can_create_in_db: true,
            has_user_objects: false,
            has_role_memberships: false,
          }],
        })
        .mockResolvedValueOnce({ rows: [{ ok: 1 }] }),
      end: vi.fn(async () => undefined),
    };

    await probeTestDatabaseConnection(
      'postgresql://smile_test:synthetic%40password@127.0.0.1:5544/smile_db_test',
      (config) => {
        clientConfig = config;
        return client as any;
      },
    );

    expect(clientConfig).toEqual({
      host: '127.0.0.1',
      port: 5544,
      database: 'smile_db_test',
      user: 'smile_test',
      password: 'synthetic@password',
      ssl: false,
      options: '-c search_path=public',
      connectionTimeoutMillis: 2000,
    });
  });

  it('closes the probe client when database identity validation fails', async () => {
    const client = {
      connect: async () => undefined,
      query: async () => ({
        rows: [{
          db: 'smile_db',
          login_user: 'smile_test',
          usr: 'smile_test',
          is_super: false,
          can_create_db: false,
          can_create_role: false,
          can_replicate: false,
          can_bypass_rls: false,
          can_create_in_db: true,
          has_user_objects: false,
          has_role_memberships: false,
        }],
      }),
      end: vi.fn(async () => undefined),
    };

    await expect(
      probeTestDatabaseConnection('postgres://smile_test:secret@localhost:5432/smile_db_test', () => client as any)
    ).rejects.toThrow("connected database is 'smile_db'");
    expect(client.end).toHaveBeenCalledTimes(1);
  });

  it('closes the probe client after a successful identity check', async () => {
    const client = {
      connect: async () => undefined,
      query: vi.fn()
        .mockResolvedValueOnce({
          rows: [{
            db: 'smile_db_test',
            login_user: 'smile_test',
            usr: 'smile_test',
            is_super: false,
            can_create_db: false,
            can_create_role: false,
            can_replicate: false,
            can_bypass_rls: false,
            can_create_in_db: true,
            has_user_objects: false,
            has_role_memberships: false,
          }],
        })
        .mockResolvedValueOnce({ rows: [{ ok: 1 }] }),
      end: vi.fn(async () => undefined),
    };

    await probeTestDatabaseConnection('postgres://smile_test:secret@localhost:5432/smile_db_test', () => client as any);
    expect(client.query).toHaveBeenCalledTimes(2);
    expect(client.end).toHaveBeenCalledTimes(1);
  });
});
