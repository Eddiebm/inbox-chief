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
          <span className="site-brand__mark" aria-hidden="true" />
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
