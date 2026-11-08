export interface YellowCardAlert {
  pupil_id: number;
  pupil_name: string;
  class_name: string;
  yellow_count: number;
}

export interface AppBannersProps {
  yellowAlertError: string | null;
  yellowAlerts: YellowCardAlert[];
  onRetryAlerts: () => void;
  isLockedByConference: boolean;
}

/** Alert-load failure and conference-lock notices shown above the main content. */
export function AppBanners({ yellowAlertError, onRetryAlerts, isLockedByConference }: AppBannersProps) {
  return (
    <>
      {/* Alert Load Error Banner */}
      {yellowAlertError && (
        <div
          role="alert"
          className="bg-rose-500/15 border-b border-rose-500/30 px-6 py-2 text-xs text-rose-200 flex items-center justify-between gap-3"
        >
          <span>Gelbe-Karten-Alarm konnte nicht geladen werden: {yellowAlertError}</span>
          <button
            type="button"
            onClick={onRetryAlerts}
            className="underline underline-offset-2 font-bold shrink-0"
          >
            Erneut versuchen
          </button>
        </div>
      )}

      {/* Conference Locked Banner */}
      {isLockedByConference && (
        <div className="bg-red-500/20 border-b border-red-500/40 px-6 py-2 text-xs text-red-300 text-center font-bold">
          🔒 Die Notenabstimmung für diese Klasse ist durch die Konferenzleitung gesperrt. Änderungen sind deaktiviert.
        </div>
      )}
    </>
  );
}
