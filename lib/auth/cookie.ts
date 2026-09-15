/**
 * The session cookie name, in a dependency-free module so both the Edge
 * middleware (which cannot import `server-only` code) and the Node session
 * layer share one source of truth.
 */
export const SESSION_COOKIE = 'sda_session';
