import type { Metadata } from "next";
import Link from "next/link";
import { ApprovalDemo } from "@/components/landing/approval-demo";
import { ReadItYourWay } from "@/components/landing/read-it-your-way";
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
    title: "It reads and sorts",
    body: "Your inbox is triaged in the background. What needs you rises to the top. The rest waits.",
  },
  {
    title: "It drafts replies",
    body: "Drafts are saved for you to review. Nothing goes to your outbox on its own.",
  },
  {
    title: "You decide",
    body: "Approve, edit or hold each message. Only you can send.",
  },
] as const;

const principles = [
  {
    title: "Control",
    body: "You decide what gets drafted, what waits, and what never leaves your outbox.",
  },
  {
    title: "Human approval",
    body: "Nothing sends without your say. Review, edit, or reject every outbound message.",
  },
  {
    title: "Privacy",
    body: "Your mail stays yours. Assistants work under your rules, not the other way around.",
  },
  {
    title: "Accountability",
    body: "A clear audit trail shows what the assistant did, when, and why, so you can trust the system.",
  },
  {
    title: "Time savings",
    body: "Triage, drafts, and follow-ups happen in the background so you reclaim focused hours.",
  },
  {
    title: "Accessibility",
    body: "Built for low vision and keyboard-first use: large type, high contrast, voice onboarding, and call-in anytime.",
  },
] as const;

const auditRows = [
  { what: "Drafted reply to Alex", why: "Asked about the project timeline", status: "Waiting for you" },
  { what: "Moved 14 newsletters aside", why: "Matched your “read later” rule", status: "Done" },
  { what: "Held reply to billing", why: "You marked billing as manual", status: "On hold" },
] as const;

export default function HomePage() {
  return (
    <div className="lp">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <SiteHeader />
      <main id="main">
        <section className="lp-hero" aria-labelledby="lp-hero-heading">
          <div className="lp-hero__copy">
            <h1 id="lp-hero-heading">
              An AI assistant that never sends without you.
            </h1>
            <p className="lp-hero__lead">
              {product.name} sorts your mail and drafts your replies. You
              approve every one. Made for people who need clarity, large
              readable type, and full control.
            </p>
            <div className="lp-ctas">
              <Link href="/signup" className="btn btn--primary btn--lg">
                Create your account
              </Link>
              <Link href="/login" className="btn btn--signin btn--lg">
                Sign in
              </Link>
            </div>
            <p className="lp-hero__hint">
              Try it: the draft is yours to approve, edit or hold.
            </p>
          </div>
          <ApprovalDemo />
        </section>

        <section className="lp-promise" aria-labelledby="lp-promise-heading">
          <h2 id="lp-promise-heading" className="sr-only">
            Our promise
          </h2>
          <p>{product.promise}</p>
        </section>

        <section className="lp-block" aria-labelledby="lp-ryw-heading">
          <div className="lp-split">
            <div className="lp-split__copy">
              <h2 id="lp-ryw-heading">Read it your way</h2>
              <p>
                Text size and contrast are settings, not afterthoughts. Try them
                on this inbox. The same controls sit in the header of every
                page.
              </p>
              <p>
                Prefer to talk? Call in any time and ask about your mail.
              </p>
            </div>
            <ReadItYourWay />
          </div>
        </section>

        <section className="lp-block" aria-labelledby="lp-how-heading">
          <h2 id="lp-how-heading" className="lp-block__title">
            How it works
          </h2>
          <ol className="lp-steps">
            {steps.map((s, i) => (
              <li key={s.title} className="lp-step">
                <span className="lp-step__n" aria-hidden="true">
                  {i + 1}
                </span>
                <div>
                  <h3>{s.title}</h3>
                  <p>{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <section
          id="benefits"
          className="lp-block"
          aria-labelledby="lp-benefits-heading"
        >
          <div className="lp-split lp-split--top">
            <div className="lp-split__copy lp-sticky">
              <h2 id="lp-benefits-heading">Built around trust, not takeover</h2>
              <p>
                {product.name} is designed so assistance never means losing the
                wheel, especially if you rely on accessible interfaces every
                day.
              </p>
            </div>
            <dl className="lp-principles">
              {principles.map((p) => (
                <div key={p.title} className="lp-principle">
                  <dt>{p.title}</dt>
                  <dd>{p.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        <section className="lp-audit" aria-labelledby="lp-audit-heading">
          <div className="lp-audit__inner">
            <h2 id="lp-audit-heading">See what it did, and why</h2>
            <p>
              Every action is recorded in plain language, so you never have to
              wonder what happened to your mail.
            </p>
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
          </div>
        </section>

        <section className="lp-cta" aria-labelledby="lp-cta-heading">
          <div className="lp-cta__inner">
            <h2 id="lp-cta-heading">Ready when you are</h2>
            <p>
              Sign up in minutes, then walk through accessible voice-guided
              onboarding at your pace.
            </p>
            <div className="lp-ctas">
              <Link href="/signup" className="btn btn--lg lp-cta__primary">
                Sign up
              </Link>
              <Link href="/login" className="btn btn--lg lp-cta__secondary">
                Sign in
              </Link>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
