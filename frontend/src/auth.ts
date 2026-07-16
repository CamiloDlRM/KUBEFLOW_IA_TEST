/* ------------------------------------------------------------------ */
/*  Minimal session management backed by localStorage                  */
/* ------------------------------------------------------------------ */

const TOKEN_KEY = 'mlops_token';
const EMAIL_KEY = 'mlops_email';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function getUserEmail(): string | null {
  return localStorage.getItem(EMAIL_KEY);
}

export function isAuthenticated(): boolean {
  return Boolean(getToken());
}

export function setSession(token: string, email: string): void {
  localStorage.setItem(TOKEN_KEY, token);
  localStorage.setItem(EMAIL_KEY, email);
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(EMAIL_KEY);
}
