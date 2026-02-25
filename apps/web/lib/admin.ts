export const ADMIN_EMAIL = '623814363@qq.com';

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return email.trim().toLowerCase() === ADMIN_EMAIL;
}
