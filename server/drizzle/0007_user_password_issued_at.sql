-- Start-password expiry (see POST /api/auth/login).
--
-- Records when each account's current password was issued. A password still flagged
-- must_change_password is refused at login once it is older than 14 days.
--
-- Existing rows receive now() at migration time, so accounts that are still waiting for
-- their first password change get a fresh 14-day window rather than expiring at deploy.
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_issued_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now() NOT NULL;
