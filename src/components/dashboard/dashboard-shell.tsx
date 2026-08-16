"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import {
  AccessibilityControls,
  applyStoredA11yPreferences,
} from "@/components/a11y/accessibility-controls";
import { OptInPageBeacon } from "@/components/analytics/opt-in-page-beacon";
import { product } from "@/lib/product";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Dashboard", exact: true },
  { href: "/dashboard/call-in", label: "Call in anytime" },
  { href: "/dashboard/inbox", label: "Inbox" },
  { href: "/dashboard/downloads", label: "Downloads" },
  { href: "/dashboard/drafts", label: "Drafts" },
  { href: "/dashboard/approvals", label: "Approvals" },
  { href: "/dashboard/contacts", label: "Contacts" },
  { href: "/dashboard/follow-ups", label: "Follow-ups" },
  { href: "/dashboard/retention", label: "Retention" },
  { href: "/dashboard/settings", label: "Settings" },
  { href: "/dashboard/billing", label: "Billing" },
  { href: "/dashboard/support", label: "Support" },
] as const;

function isActive(pathname: string, href: string, exact?: boolean) {
  if (exact) return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

type DashboardShellProps = {
  children: ReactNode;
};

export function DashboardShell({ children }: DashboardShellProps) {
  const pathname = usePathname();

  useEffect(() => {
    applyStoredA11yPreferences();
  }, []);

  useEffect(() => {
    const main = document.getElementById("main-content");
    main?.focus({ preventScroll: true });
  }, [pathname]);

  return (
    <div className="dash-app">
      <OptInPageBeacon />
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <header className="dash-header">
        <div className="dash-header__inner">
          <Link
            href="/dashboard"
            className="site-brand"
            aria-label={`${product.name} dashboard home`}
          >
            <span className="site-brand__mark" aria-hidden="true" />
            <span className="site-brand__name">{product.name}</span>
          </Link>

          <AccessibilityControls variant="compact" />
        </div>
      </header>

      <div className="dash-layout">
        <nav className="dash-nav" aria-label="Product">
          <ul className="dash-nav__list">
            {NAV_ITEMS.map((item) => {
              const active = isActive(
                pathname,
                item.href,
                "exact" in item ? item.exact : false,
              );
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={
                      active ? "dash-nav__link is-active" : "dash-nav__link"
                    }
                    aria-current={active ? "page" : undefined}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <main id="main-content" className="dash-body" tabIndex={-1}>
          {children}
        </main>
      </div>

      <footer className="dash-footer">
        <form
          action="/api/auth/logout"
          method="post"
          onSubmit={async (e) => {
            e.preventDefault();
            await fetch("/api/auth/logout", { method: "POST" });
            window.location.href = "/login";
          }}
        >
          <button type="submit" className="btn-secondary">
            Sign out
          </button>
        </form>
      </footer>
    </div>
  );
}
