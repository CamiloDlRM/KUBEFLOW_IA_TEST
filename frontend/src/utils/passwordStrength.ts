export interface PasswordStrength {
  score: number;
  color: string;
  label: string;
}

export function calculatePasswordStrength(password: string): PasswordStrength {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  if (score <= 2) return { score, color: 'bg-red-500', label: 'Debil' };
  if (score === 3) return { score, color: 'bg-yellow-500', label: 'Media' };
  return { score, color: 'bg-green-500', label: 'Fuerte' };
}
