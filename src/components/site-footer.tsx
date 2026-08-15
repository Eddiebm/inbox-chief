import Link from "next/link";
import { product } from "@/lib/product";

const footerLinks = [
  { href: "/pricing", label: "Pricing" },
  { href: "/privacy", label: "Privacy" },
  { href: "/terms", label: "Terms" },
  { href: "/dpa", label: "DPA" },
  { href: "/login", label: "Sign in" },
  { href: "/signup", label: "Sign up" },
  { href: "/onboarding", label: "Onboarding" },
] as const;

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="site-footer__inner">
        <div className="site-footer__brand">
          <p className="site-footer__name">{product.name}</p>
          <p className="site-footer__tagline">{product.tagline}</p>
        </div>

        <nav aria-label="Footer">
          <ul className="site-footer__list">
            {footerLinks.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="site-footer__link">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <p className="site-footer__legal">
        © {new Date().getFullYear()} {product.name}. You stay in control of
        your email.
      </p>
    </footer>
  );
}
