import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { formatPlanPrice, plans } from "@/lib/plans";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: `Pricing — ${product.name}`,
  description: `${product.name} Patron and Pro plans with included call-in minutes plus prepaid minute packs — never unlimited, never surprise overage.`,
};

export default function PricingPage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <SiteHeader />
      <main id="main" className="page">
        <header className="page-header">
          <h1>Pricing</h1>
          <p>
            Transparent plans with included phone call-in minutes. When those
            run out, buy prepaid minute packs (they roll over until used),
            upgrade, or wait for the next period — no surprise overage. We do
            not offer unlimited calling. Every tier keeps human approval and
            accessibility front and center.
          </p>
        </header>

        <ul className="pricing-grid">
          {plans.map((plan) => (
            <li
              key={plan.id}
              className={
                plan.highlighted
                  ? "pricing-card pricing-card--featured"
                  : "pricing-card"
              }
            >
              {plan.highlighted ? (
                <p className="pricing-card__badge">Most chosen</p>
              ) : null}
              <h2>{plan.name}</h2>
              <p className="pricing-card__price">{formatPlanPrice(plan)}</p>
              <p className="pricing-card__desc">{plan.description}</p>
              <ul className="pricing-card__features">
                {plan.features.map((feature) => (
                  <li key={feature}>{feature}</li>
                ))}
              </ul>
              <Link href={plan.ctaHref} className="btn btn--primary btn--block">
                {plan.ctaLabel}
              </Link>
            </li>
          ))}
        </ul>
      </main>
      <SiteFooter />
    </>
  );
}
