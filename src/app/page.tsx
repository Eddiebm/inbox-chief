import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: {
    absolute: `${product.name} — Secure AI email assistant you control`,
  },
  description: product.promise,
};

const benefits = [
  {
    title: "Control",
    body: "You decide what gets drafted, what waits, and what never leaves your outbox.",
  },
  {
    title: "Privacy",
    body: "Your mail stays yours. Assistants work under your rules—not the other way around.",
  },
  {
    title: "Time savings",
    body: "Triage, drafts, and follow-ups happen in the background so you reclaim focused hours.",
  },
  {
    title: "Accessibility",
    body: "Built for low vision and keyboard-first use: large type, high contrast, voice onboarding, and call-in anytime.",
  },
  {
    title: "Human approval",
    body: "Nothing sends without your say. Review, edit, or reject every outbound message.",
  },
  {
    title: "Accountability",
    body: "A clear audit trail shows what the assistant did, when, and why—so you can trust the system.",
  },
] as const;

export default function HomePage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <SiteHeader />
      <main id="main">
        <section className="hero" aria-labelledby="hero-brand">
          <div className="hero__copy">
            <p id="hero-brand" className="hero__brand">
              {product.name}
            </p>
            <h1 className="hero__headline">
              An AI assistant that never sends without you.
            </h1>
            <p className="hero__support">
              Accessibility-first email help for busy people who need clarity,
              large readable type, and full control of every message.
            </p>
            <div className="hero__ctas">
              <Link href="/signup" className="btn btn--primary btn--lg">
                Create your account
              </Link>
              <Link href="/login" className="btn btn--signin btn--lg">
                Sign in
              </Link>
            </div>
          </div>

          <div className="hero__visual" aria-hidden="true">
            <div className="hero-panel">
              <div className="hero-panel__chrome">
                <span />
                <span />
                <span />
              </div>
              <p className="hero-panel__label">Awaiting your approval</p>
              <div className="hero-panel__message">
                <strong>Draft ready</strong>
                <span>Reply to Alex — project timeline</span>
              </div>
              <div className="hero-panel__actions">
                <span className="hero-chip hero-chip--approve">Approve</span>
                <span className="hero-chip">Edit</span>
                <span className="hero-chip">Hold</span>
              </div>
            </div>
          </div>
        </section>

        <section className="promise-band" aria-labelledby="promise-heading">
          <h2 id="promise-heading" className="sr-only">
            Our promise
          </h2>
          <p className="promise-band__text">{product.promise}</p>
        </section>

        <section
          id="benefits"
          className="benefits"
          aria-labelledby="benefits-heading"
        >
          <div className="section-intro">
            <h2 id="benefits-heading">Built around trust, not takeover</h2>
            <p>
              {product.name} is designed so assistance never means losing the
              wheel—especially if you rely on accessible interfaces every day.
            </p>
          </div>
          <ul className="benefits__grid">
            {benefits.map((benefit) => (
              <li key={benefit.title} className="benefit">
                <h3>{benefit.title}</h3>
                <p>{benefit.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="cta-band" aria-labelledby="cta-heading">
          <h2 id="cta-heading">Ready when you are</h2>
          <p>
            Sign up in minutes, then walk through accessible voice-guided
            onboarding at your pace.
          </p>
          <div className="hero__ctas">
            <Link href="/signup" className="btn btn--primary btn--lg">
              Sign up
            </Link>
            <Link href="/login" className="btn btn--signin btn--lg">
              Sign in
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
