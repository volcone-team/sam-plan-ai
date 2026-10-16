/**
 * A policy link, or just its name when no URL is configured.
 *
 * Never renders a dead anchor: an `href` of "#" or "" looks clickable and does
 * nothing. Until an admin sets the URL on /admin/settings the label stays plain
 * text. Opens in a new tab so the reader does not lose what they were doing,
 * with `rel="noopener noreferrer"` because the destination is admin-supplied.
 */
export function LegalLink({
  href,
  children,
}: {
  href: string | null;
  children: React.ReactNode;
}) {
  if (!href) return <span className="font-medium text-foreground">{children}</span>;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-[hsl(var(--primary))] hover:underline"
    >
      {children}
    </a>
  );
}
