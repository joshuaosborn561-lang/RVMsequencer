import { maskPhone } from "@/lib/allo/client";

export { maskPhone };

/** Last-letter email mask — never log a full address. */
export function maskEmail(email: string | null | undefined): string {
  if (!email) return "****";
  const at = email.indexOf("@");
  if (at < 1) return "****";
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const keep = local.slice(0, 1);
  return `${keep}***@${maskDomain(domain)}`;
}

export function maskDomain(domain: string | null | undefined): string {
  if (!domain) return "****";
  const host = domain.replace(/^www\./i, "");
  const i = host.lastIndexOf(".");
  if (i <= 1) return "***";
  return `${host.slice(0, 1)}***${host.slice(i)}`;
}
