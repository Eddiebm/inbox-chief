import Link from "next/link";
import { AccessibilityControls } from "@/components/a11y/accessibility-controls";
import { product } from "@/lib/product";

const navLinks = [
  { href: "/#benefits", label: "Benefits" },
  { href: "/pricing", label: "Pricing" },
  { href: "/privacy", label: "Privacy" },
  { href: "/login", label: "Sign in" },
] as const;

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="site-header__inner">
        <Link href="/" className="site-brand" aria-label={`${product.name} home`}>
          <svg
            className="site-brand__mark"
            style={{ width: "2rem", height: "2rem", background: "none", border: 0, color: "var(--accent)" }}
            viewBox="0 0 32 32"
            aria-hidden="true"
          >
            <rect width="32" height="32" rx="8" fill="currentColor" />
            <path d="M7 11l9 7 9-7" fill="none" stroke="var(--signal, #fff)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M9 22h14" stroke="#fff" strokeWidth="3" strokeLinecap="round" />
          </svg>
          <span className="site-brand__name">{product.name}</span>
        </Link>

        <nav className="site-nav" aria-label="Primary">
          <ul className="site-nav__list">
            {navLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="site-nav__link">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>

        <div className="site-header__actions">
          <AccessibilityControls variant="compact" />
          <Link
            href="/login"
            className="btn btn--signin"
            aria-label="Sign in to your account"
          >
            Sign in
          </Link>
          <Link href="/signup" className="btn btn--primary">
            Sign up
          </Link>
        </div>
      </div>
    </header>
  );
}
