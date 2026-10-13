import { useCallback, useEffect, useState } from 'react';
import { getTimeoutEscalations } from '../../services/api';
import type { User } from '../../types';

/**
 * Pending time-out escalation count for the school leadership badge. Loaded only for
 * leadership accounts that are not forced to change their password.
 */
export function useTimeoutEscalations(currentUser: User | null, isSchoolLeadership: boolean) {
  const [pendingTimeoutCount, setPendingTimeoutCount] = useState(0);

  const refreshPendingTimeoutCount = useCallback(() => {
    getTimeoutEscalations()
      .then((res) => setPendingTimeoutCount(res.totalPendingCount || 0))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (currentUser && !currentUser.mustChangePassword && isSchoolLeadership) {
      refreshPendingTimeoutCount();
    }
  }, [currentUser, isSchoolLeadership]);

  return { pendingTimeoutCount, refreshPendingTimeoutCount };
}
