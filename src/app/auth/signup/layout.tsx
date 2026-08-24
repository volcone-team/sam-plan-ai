// Force this route to be dynamically rendered (not prerendered)
// because the page uses browser APIs (window, localStorage)
export const dynamic = 'force-dynamic';

export default function SignupLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
