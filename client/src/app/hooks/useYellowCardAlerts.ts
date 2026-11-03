import { useCallback, useState } from 'react';
import { getYellowCardAlerts } from '../../services/api';

/** Yellow-card alert list with its own error channel, so a failed load is never shown as empty. */
export function useYellowCardAlerts() {
  const [yellowAlerts, setYellowAlerts] = useState<any[]>([]);
  const [yellowAlertError, setYellowAlertError] = useState<string | null>(null);

  const refreshYellowCardAlerts = useCallback(async () => {
    setYellowAlertError(null);
    try {
      setYellowAlerts(await getYellowCardAlerts());
    } catch (error) {
      setYellowAlertError(error instanceof Error ? error.message : 'Warnhinweise konnten nicht geladen werden.');
    }
  }, []);

  return {
    yellowAlerts,
    setYellowAlerts,
    yellowAlertError,
    setYellowAlertError,
    refreshYellowCardAlerts,
  };
}
