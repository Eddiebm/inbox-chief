import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { product } from "@/lib/product";
import "./landing.css";

export const metadata: Metadata = {
  title: {
    absolute: `${product.name} — Secure AI email assistant you control`,
  },
  description: product.promise,
};

const steps = [
  {
    n: "1",
    title: "It reads and sorts",
    body: "Your inbox is triaged in the background. Urgent mail rises, noise waits.",
  },
  {
    n: "2",
    title: "It drafts replies",
    body: "Drafts are written in your voice and saved for you. Nothing leaves your outbox.",
  },
  {
    n: "3",
    title: "You decide",
    body: "Approve, edit, or hold every message. Only you can press send.",
  },
] as const;

const benefits = [
  {
    title: "Control",
    body: "You decide what gets drafted, what waits, and what never leaves your outbox.",
    icon: "M4 6h16M4 12h16M4 18h16M8 4v4M16 10v4M10 16v4",
  },
  {
    title: "Privacy",
    body: "Your mail stays yours. Assistants work under your rules—not the other way around.",
    icon: "M6 10V8a6 6 0 1 1 12 0v2M5 10h14v10H5z",
  },
  {
    title: "Time savings",
    body: "Triage, drafts, and follow-ups happen in the background so you reclaim focused hours.",
    icon: "M12 7v5l3 2M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z",
  },
  {
    title: "Accessibility",
    body: "Built for low vision and keyboard-first use: large type, high contrast, voice onboarding, and call-in anytime.",
    icon: "M12 4.5v.01M5 8.5l7 1.5 7-1.5M12 10v4l-3 6M12 14l3 6",
  },
  {
    title: "Human approval",
    body: "Nothing sends without your say. Review, edit, or reject every outbound message.",
    icon: "M5 12.5l4.5 4.5L19 7.5",
  },
  {
    title: "Accountability",
    body: "A clear audit trail shows what the assistant did, when, and why—so you can trust the system.",
    icon: "M6 3h9l4 4v14H6zM9 12h7M9 16h7M9 8h3",
  },
] as const;

const auditRows = [
  { what: "Drafted reply to Alex", why: "Asked about project timeline", status: "Awaiting you" },
  { what: "Moved 14 newsletters aside", why: "Matched your “read later” rule", status: "Done" },
  { what: "Held reply to billing", why: "You marked billing as manual", status: "Held" },
] as const;

function Icon({ d }: { d: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="28"
      height="28"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

export default function HomePage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <SiteHeader />
      <main id="main" className="lp">
        <section className="lp-hero" aria-labelledby="lp-hero-heading">
          <div className="lp-hero__copy">
            <p className="lp-eyebrow">{product.name}</p>
            <h1 id="lp-hero-heading" className="lp-hero__title">
              An AI assistant that <em>never sends</em> without you.
            </h1>
            <p className="lp-hero__lead">
              Accessibility-first email help for busy people who need clarity,
              large readable type, and full control of every message.
            </p>
            <div className="lp-ctas">
              <Link href="/signup" className="btn btn--primary btn--lg">
                Create your account
              </Link>
              <Link href="/login" className="btn btn--signin btn--lg">
                Sign in
              </Link>
            </div>
            <ul className="lp-hero__points">
              <li>Large type &amp; high contrast</li>
              <li>Keyboard and voice friendly</li>
              <li>Every action logged</li>
            </ul>
          </div>

          <div className="lp-hero__visual" aria-hidden="true">
            <div className="lp-mail">
              <div className="lp-mail__bar">
                <span />
                <span />
                <span />
                <p>Awaiting your approval</p>
              </div>
              <div className="lp-mail__thread">
                <p className="lp-mail__from">Alex Rivera</p>
                <p className="lp-mail__subject">Project timeline</p>
                <p className="lp-mail__snippet">
                  Can we confirm the Thursday review before Friday&rsquo;s
                  launch?
                </p>
              </div>
              <div className="lp-mail__draft">
                <p className="lp-mail__tag">Draft ready</p>
                <p>
                  Thursday works. I&rsquo;ll send the updated timeline this
                  afternoon so we can review together.
                </p>
                <div className="lp-mail__actions">
                  <span className="lp-chip lp-chip--approve">Approve</span>
                  <span className="lp-chip">Edit</span>
                  <span className="lp-chip">Hold</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="lp-promise" aria-labelledby="lp-promise-heading">
          <h2 id="lp-promise-heading" className="sr-only">
            Our promise
          </h2>
          <p>{product.promise}</p>
        </section>

        <section className="lp-section" aria-labelledby="lp-how-heading">
          <div className="lp-intro">
            <h2 id="lp-how-heading">How it works</h2>
            <p>Three steps, and you are in charge of the last one.</p>
          </div>
          <ol className="lp-steps">
            {steps.map((s) => (
              <li key={s.n} className="lp-step">
                <span className="lp-step__n" aria-hidden="true">
                  {s.n}
                </span>
                <h3>{s.title}</h3>
                <p>{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section
          id="benefits"
          className="lp-section"
          aria-labelledby="lp-benefits-heading"
        >
          <div className="lp-intro">
            <h2 id="lp-benefits-heading">Built around trust, not takeover</h2>
            <p>
              {product.name} is designed so assistance never means losing the
              wheel—especially if you rely on accessible interfaces every day.
            </p>
          </div>
          <ul className="lp-grid">
            {benefits.map((b) => (
              <li key={b.title} className="lp-card">
                <span className="lp-card__icon">
                  <Icon d={b.icon} />
                </span>
                <h3>{b.title}</h3>
                <p>{b.body}</p>
              </li>
            ))}
          </ul>
        </section>

        <section className="lp-section" aria-labelledby="lp-audit-heading">
          <div className="lp-intro lp-intro--left">
            <h2 id="lp-audit-heading">See what it did, and why</h2>
            <p>
              Every action your assistant takes is recorded in plain language, so
              you never have to wonder what happened to your mail.
            </p>
          </div>
          <div className="lp-table-wrap">
            <table className="lp-table">
              <caption className="sr-only">Example audit trail</caption>
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col">Why</th>
                  <th scope="col">Status</th>
                </tr>
              </thead>
              <tbody>
                {auditRows.map((r) => (
                  <tr key={r.what}>
                    <th scope="row">{r.what}</th>
                    <td>{r.why}</td>
                    <td>
                      <span className="lp-status">{r.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="lp-cta" aria-labelledby="lp-cta-heading">
          <h2 id="lp-cta-heading">Ready when you are</h2>
          <p>
            Sign up in minutes, then walk through accessible voice-guided
            onboarding at your pace.
          </p>
          <div className="lp-ctas lp-ctas--center">
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
