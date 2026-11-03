/** Allowlisted error metadata for logs; deliberately omit message, stack and cause. */
export function safeErrorLogFields(error: unknown): {
  errorType: string;
  statusCode?: number;
} {
  const candidate = error && typeof error === 'object'
    ? error as { name?: unknown; statusCode?: unknown }
    : {};
  return {
    errorType: typeof candidate.name === 'string' && candidate.name ? candidate.name : 'UnknownError',
    ...(typeof candidate.statusCode === 'number' ? { statusCode: candidate.statusCode } : {}),
  };
}
