/** Normalize to E.164 for US/CA NANP when possible. */
export function toE164(phone: string): string | null {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  if (digits.length === 10) return `+1${digits}`;
  if (phone.startsWith("+") && digits.length >= 10) return `+${digits}`;
  return null;
}

export function digitsOnly(phone: string): string {
  return phone.replace(/\D/g, "");
}

/** Spec: 10-digit US normalize then E.164. */
export function normalizeContactPhone(raw: string | undefined): string | null {
  if (!raw) return null;
  const ten = raw.replace(/\D/g, "").match(/(\d{10})$/)?.[1];
  if (!ten) return null;
  return toE164(ten);
}
