/**
 * Template variables: write {{first_name}} in a template, or give a fallback
 * for when the value is unknown: {{first_name|there}} → "Hi there,".
 */
export const TEMPLATE_VARIABLES = [
  { key: "first_name", label: "Recipient's first name" },
  { key: "name", label: "Recipient's full name" },
  { key: "email", label: "Recipient's email" },
  { key: "ticket_number", label: "Ticket number" },
  { key: "subject", label: "Ticket subject" },
  { key: "agent_name", label: "Your name" },
  { key: "agent_first_name", label: "Your first name" },
] as const;

export type TemplateVars = Partial<Record<(typeof TEMPLATE_VARIABLES)[number]["key"], string>>;

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

export function fillTemplate(html: string, vars: TemplateVars) {
  return html.replace(/\{\{\s*([a-z_]+)\s*(?:\|([^}]*))?\}\}/gi, (_, key: string, fallback?: string) => {
    const value = vars[key.toLowerCase() as keyof TemplateVars]?.trim();
    return escapeHtml(value || fallback?.trim() || "");
  });
}

/**
 * Best guess at someone's first name: from their display name, else from an
 * address like "jamie.rivera@…". Initial-style addresses ("jrivera") give
 * nothing, so the template's fallback applies.
 */
export function firstNameOf(name: string | null | undefined, email?: string | null) {
  const fromName = name?.trim().split(/\s+/)[0];
  if (fromName && !fromName.includes("@")) return capitalize(fromName.replace(/[^\p{L}'-]/gu, ""));
  const local = email?.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  return parts.length >= 2 ? capitalize(parts[0]) : "";
}

function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

export function recipientVars(
  recipient: { name?: string | null; email?: string | null },
  extra: TemplateVars = {},
): TemplateVars {
  return {
    first_name: firstNameOf(recipient.name, recipient.email),
    name: recipient.name ?? "",
    email: recipient.email ?? "",
    ...extra,
  };
}
