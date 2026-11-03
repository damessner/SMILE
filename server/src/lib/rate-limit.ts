/**
 * Choose a global rate-limit bucket from verified authentication state only.
 * Never decode an unverified JWT to choose a bucket: callers can forge the id
 * claim and rotate identities to bypass an IP-based limit.
 */
export function rateLimitKey(
  authUser: { id?: string } | undefined,
  ip: string,
): string {
  return authUser?.id ? `user:${authUser.id}` : ip;
}
