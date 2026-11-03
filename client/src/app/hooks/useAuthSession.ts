import { useCallback, useEffect, useState } from 'react';
import { getMe, logout, SESSION_EXPIRED_EVENT } from '../../services/api';
import type { User } from '../../types';
import type { useToast } from '../../components/Toast';

export interface UseAuthSessionOptions {
  toast: ReturnType<typeof useToast>;
  loadClasses: (user: User) => Promise<void>;
  clearClassState: () => void;
  setLoadingClass: (value: boolean) => void;
  setYellowAlerts: (value: any[]) => void;
  setYellowAlertError: (value: string | null) => void;
}

/**
 * Current user, auth bootstrap, logout and session-expiry handling. The session lives
 * in an httpOnly cookie, so a single /auth/me call is the liveness probe.
 */
export function useAuthSession({
  toast,
  loadClasses,
  clearClassState,
  setLoadingClass,
  setYellowAlerts,
  setYellowAlertError,
}: UseAuthSessionOptions) {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);

  /** A user who may proceed gets their class list; a forced password change waits. */
  const handleAuthenticated = (user: User) => {
    setCurrentUser(user);
    if (!user.mustChangePassword) {
      loadClasses(user);
    }
  };

  // 1. Check Auth on mount
  useEffect(() => {
    getMe()
      .then((user) => handleAuthenticated(user))
      .catch(() => setCurrentUser(null))
      .finally(() => setLoadingAuth(false));
  }, []);

  const handleSessionExpired = useCallback(() => {
    if (currentUser) toast.error('Ihre Sitzung ist abgelaufen. Bitte melden Sie sich erneut an.');
    setCurrentUser(null);
    clearClassState();
    setYellowAlerts([]);
    setYellowAlertError(null);
    setLoadingAuth(false);
    setLoadingClass(false);
  }, [currentUser, toast]);

  useEffect(() => {
    window.addEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
    return () => window.removeEventListener(SESSION_EXPIRED_EVENT, handleSessionExpired);
  }, [handleSessionExpired]);

  const handleLogout = async () => {
    try {
      await logout();
    } catch (error) {
      // The cookie is httpOnly. Clearing local state after a failed logout
      // would show the login screen while a reload signs the same user back in
      // on a shared device. Keep them logged in and tell them the truth.
      toast.error(
        error instanceof Error
          ? `Abmeldung konnte nicht bestätigt werden: ${error.message}`
          : 'Abmeldung konnte nicht bestätigt werden. Bitte erneut versuchen.',
      );
      return;
    }
    setCurrentUser(null);
    clearClassState();
    setYellowAlerts([]);
  };

  /** Called by the forced-change-password form once the user sets a new password. */
  const handlePasswordChanged = (user: User) => {
    setCurrentUser(user);
    loadClasses(user);
  };

  return {
    currentUser,
    loadingAuth,
    handleLoginSuccess: handleAuthenticated,
    handleLogout,
    handlePasswordChanged,
  };
}
