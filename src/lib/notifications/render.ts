/**
 * Email template renderer for initiative notifications.
 *
 * Templates are admin-authored (subject + HTML body) and stored in the
 * `email_templates` table. Rendering interpolates a fixed set of
 * {{variables}} at send time, per recipient.
 *
 * Safety:
 * - Interpolated VALUES are HTML-escaped, so an initiative name containing
 *   `<script>` cannot inject markup through the template (Req 7.3).
 * - Missing/null values resolve to safe fallbacks — never a leftover
 *   {{placeholder}} and never a failed send (Req 7.3).
 * - Unknown placeholders collapse to empty string.
 * - A null template, or any error during rendering, falls back to a built-in
 *   default so a reminder still goes out with correct content (Req 7.4, 7.5).
 */

export interface TemplateVars {
  firstName?: string | null;
  initiativeName?: string | null;
  channel?: string | null;
  daysUntil?: number | null;
  activationDate?: string | null;
}

export interface EmailTemplate {
  subject: string;
  body_html: string;
}

export interface RenderedEmail {
  subject: string;
  html: string;
}

const SUPPORTED = ["firstName", "initiativeName", "channel", "daysUntil", "activationDate"] as const;

/** Built-in fallback used when no template is configured or rendering fails. */
const DEFAULT_TEMPLATE: EmailTemplate = {
  subject: 'Your {{channel}} "{{initiativeName}}" goes live in {{daysUntil}} days',
  body_html:
    "<p>Hi {{firstName}},</p>" +
    "<p>Your {{channel}} <strong>{{initiativeName}}</strong> is scheduled for " +
    "{{activationDate}} — that's {{daysUntil}} days away.</p>" +
    "<p>Now is a good time to make sure everything is ready.</p>",
};

function escapeHtml(v: string): string {
  return v
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Resolve a variable to its safe, HTML-escaped string value. */
function resolve(name: string, vars: TemplateVars): string {
  switch (name) {
    case "firstName":
      return escapeHtml((vars.firstName ?? "").trim() || "there");
    case "initiativeName":
      return escapeHtml((vars.initiativeName ?? "").trim() || "your initiative");
    case "channel":
      return escapeHtml((vars.channel ?? "").trim() || "initiative");
    case "daysUntil":
      return vars.daysUntil != null && Number.isFinite(vars.daysUntil)
        ? String(vars.daysUntil)
        : "a few";
    case "activationDate":
      return escapeHtml((vars.activationDate ?? "").trim() || "soon");
    default:
      return "";
  }
}

function interpolate(text: string, vars: TemplateVars): string {
  // Replace every {{token}} (any whitespace inside braces) with a resolved
  // value; unknown tokens become empty string via resolve()'s default.
  return text.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, token: string) =>
    (SUPPORTED as readonly string[]).includes(token) ? resolve(token, vars) : ""
  );
}

/**
 * Render a template with the given variables.
 * @param tpl the configured template, or null to force the built-in default
 */
export function renderTemplate(tpl: EmailTemplate | null | undefined, vars: TemplateVars): RenderedEmail {
  const source = tpl && tpl.subject && tpl.body_html ? tpl : DEFAULT_TEMPLATE;
  try {
    return {
      subject: interpolate(source.subject, vars),
      html: interpolate(source.body_html, vars),
    };
  } catch {
    // Any unexpected failure → built-in default, never a broken/aborted send.
    return {
      subject: interpolate(DEFAULT_TEMPLATE.subject, vars),
      html: interpolate(DEFAULT_TEMPLATE.body_html, vars),
    };
  }
}

export { DEFAULT_TEMPLATE };
