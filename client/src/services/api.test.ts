import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, applyClassDefault, batchUpdateItems, changePassword, getClasses, getYellowCardAlerts, login, SESSION_EXPIRED_EVENT } from './api';

function response(status: number, body: unknown): Response {
  const mockedResponse = {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    clone: () => mockedResponse,
  };
  return mockedResponse as Response;
}

describe('API session and alert errors', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let sessionExpired: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    sessionExpired = vi.fn();
    window.addEventListener('smile-session-expired', sessionExpired);
  });

  afterEach(() => {
    window.removeEventListener('smile-session-expired', sessionExpired);
    vi.unstubAllGlobals();
  });

  it('preserves alert-load failures instead of displaying an empty alert list', async () => {
    fetchMock.mockResolvedValue(response(503, { error: 'Service unavailable' }));

    await expect(getYellowCardAlerts()).rejects.toMatchObject({
      name: 'ApiError',
      status: 503,
      message: 'Service unavailable',
    });
  });

  it('broadcasts a central session-expired event for protected API 401 responses', async () => {
    fetchMock.mockResolvedValue(response(401, { error: 'Nicht authentifiziert' }));

    await expect(getClasses()).rejects.toBeInstanceOf(ApiError);
    expect(sessionExpired).toHaveBeenCalledTimes(1);
  });

  it('does not interpret invalid login credentials as an expired session', async () => {
    fetchMock.mockResolvedValue(response(401, { error: 'Ungültige Zugangsdaten.' }));

    await expect(login('teacher', 'wrong password')).rejects.toBeInstanceOf(ApiError);
    expect(sessionExpired).not.toHaveBeenCalled();
  });

  it('does not expire the session for an incorrect current password', async () => {
    const sessionExpired = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, sessionExpired);
    fetchMock.mockResolvedValue(response(401, {
      error: 'Das aktuelle Passwort ist nicht korrekt.',
      code: 'INVALID_CURRENT_PASSWORD',
    }));

    await expect(changePassword('synthetic-wrong-password', 'SyntheticNewPassword123'))
      .rejects.toMatchObject({ status: 401, code: 'INVALID_CURRENT_PASSWORD' });

    expect(sessionExpired).not.toHaveBeenCalled();
    window.removeEventListener(SESSION_EXPIRED_EVENT, sessionExpired);
  });

  it('expires the local session when the server requires a reset before data access', async () => {
    const sessionExpired = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, sessionExpired);
    fetchMock.mockResolvedValue(response(403, {
      error: 'Bitte setzen Sie zuerst ein neues Passwort.',
      code: 'PASSWORD_CHANGE_REQUIRED',
    }));

    await expect(getClasses()).rejects.toMatchObject({ status: 403, code: 'PASSWORD_CHANGE_REQUIRED' });

    expect(sessionExpired).toHaveBeenCalledTimes(1);
    window.removeEventListener(SESSION_EXPIRED_EVENT, sessionExpired);
  });

  it('preserves current rating data from an HTTP optimistic-concurrency conflict', async () => {
    fetchMock.mockResolvedValue(response(409, {
      error: 'Bewertung wurde zwischenzeitlich geändert.',
      code: 'CONFLICT',
      evaluationId: 'eval-1',
      pupilId: 1,
      itemKey: 'org_1',
      subjectCode: 'M',
      currentRating: 'sad',
      currentVersion: 9,
    }));

    await expect(batchUpdateItems(1, 3, 'M', [
      { criterionId: 'criterion-1', itemKey: 'org_1', rating: 'smile', version: 7 },
    ])).rejects.toMatchObject({
      name: 'ApiError',
      status: 409,
      code: 'CONFLICT',
      details: {
        evaluationId: 'eval-1',
        pupilId: 1,
        itemKey: 'org_1',
        subjectCode: 'M',
        currentRating: 'sad',
        currentVersion: 9,
      },
    });
    const requestOptions = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestOptions.body)).items[0].version).toBe(7);
  });

  it('makes whole-class default application explicitly acknowledge overwriting ratings', async () => {
    fetchMock.mockResolvedValue(response(200, { success: true }));

    await applyClassDefault(1, 'D');

    const requestOptions = fetchMock.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(String(requestOptions.body))).toMatchObject({ forceOverwrite: true });
  });
});
