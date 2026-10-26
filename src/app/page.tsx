import type { Metadata } from "next";
import Link from "next/link";
import { AccessibilityControls } from "@/components/a11y/accessibility-controls";
import { ApprovalDemo } from "@/components/landing/approval-demo";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: {
    absolute: `${product.name} — Secure AI email assistant you control`,
  },
  description: product.promise,
};

const steps = [
  {
    lead: "First, it reads and sorts.",
    body: "Your inbox is triaged in the background. What needs you comes first. The rest waits.",
  },
  {
    lead: "Then, it drafts replies.",
    body: "Drafts are saved for you to review. Nothing goes to your outbox on its own.",
  },
  {
    lead: "Finally, you decide.",
    body: "Approve, edit or hold each message. Only you can send.",
  },
] as const;

const ways = [
  {
    term: "By keyboard",
    detail: "Built keyboard-first, so you never need a mouse.",
  },
  {
    term: "By voice",
    detail:
      "Set up with every step spoken aloud. Continue, skip or use the keyboard at any point.",
  },
  {
    term: "By phone",
    detail: "Call in any time and ask about your mail.",
  },
  {
    term: "In large type",
    detail:
      "Large text and high contrast, with settings you control. Try them above.",
  },
] as const;

const principles = [
  {
    term: "Control",
    detail:
      "You decide what gets drafted, what waits, and what never leaves your outbox.",
  },
  {
    term: "Human approval",
    detail:
      "Nothing sends without your say. Review, edit, or reject every outbound message.",
  },
  {
    term: "Privacy",
    detail:
      "Your mail stays yours. Assistants work under your rules, not the other way around.",
  },
  {
    term: "Accountability",
    detail:
      "A clear audit trail shows what the assistant did, when, and why, so you can trust the system.",
  },
  {
    term: "Time savings",
    detail:
      "Triage, drafts, and follow-ups happen in the background so you reclaim focused hours.",
  },
  {
    term: "Accessibility",
    detail:
      "Built for low vision and keyboard-first use: large type, high contrast, voice onboarding, and call-in anytime.",
  },
] as const;

const auditRows = [
  {
    what: "Drafted reply to Alex",
    why: "Asked about the project timeline",
    status: "Waiting for you",
  },
  {
    what: "Moved 14 newsletters aside",
    why: "Matched your “read later” rule",
    status: "Done",
  },
  {
    what: "Held reply to billing",
    why: "You marked billing as manual",
    status: "On hold",
  },
] as const;

export default function HomePage() {
  return (
    <div className="lp">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <SiteHeader />
      <main id="main">
        <div className="lp-wrap">
          <section className="lp-hero" aria-labelledby="lp-hero-heading">
            <h1 id="lp-hero-heading">
              An AI assistant that never sends without you.
            </h1>
            <p className="lp-hero__lead">
              {product.name} reads your mail, sorts it and drafts your replies.
              You approve every one before it goes. Built for people with low
              vision, and for anyone who works by keyboard or by voice.
            </p>
            <div className="lp-ctas">
              <Link href="/signup" className="btn btn--primary btn--lg">
                Create your account
              </Link>
              <Link href="/login" className="btn btn--signin btn--lg">
                Sign in
              </Link>
            </div>
          </section>

          <p className="lp-promise">{product.promise}</p>

          <section className="lp-section" aria-labelledby="lp-try-heading">
            <h2 id="lp-try-heading">Try the approval yourself</h2>
            <p className="lp-section__intro">
              This is a sample message. Nothing here is real, and nothing leaves
              this page. Choose Approve, Edit or Hold. Watch the count of
              messages sent without you.
            </p>
            <div className="lp-section__body">
              <ApprovalDemo />
            </div>
          </section>

          <section className="lp-section" aria-labelledby="lp-set-heading">
            <h2 id="lp-set-heading">Make it comfortable first</h2>
            <p className="lp-section__intro">
              Change text size, contrast, spacing and motion. Your choices are
              saved on this device.
            </p>
            <div className="lp-section__body">
              <AccessibilityControls />
            </div>
          </section>

          <section className="lp-section" aria-labelledby="lp-how-heading">
            <h2 id="lp-how-heading">How it works</h2>
            <div className="lp-section__body">
              <ol className="lp-steps">
                {steps.map((s) => (
                  <li key={s.lead}>
                    <strong>{s.lead}</strong>
                    <p>{s.body}</p>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section className="lp-section" aria-labelledby="lp-ways-heading">
            <h2 id="lp-ways-heading">Use it the way you work</h2>
            <div className="lp-section__body">
              <dl className="lp-defs">
                {ways.map((w) => (
                  <div key={w.term}>
                    <dt>{w.term}</dt>
                    <dd>{w.detail}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          <section
            id="benefits"
            className="lp-section"
            aria-labelledby="lp-benefits-heading"
          >
            <h2 id="lp-benefits-heading">Built around trust, not takeover</h2>
            <p className="lp-section__intro">
              {product.name} is designed so assistance never means losing the
              wheel, especially if you rely on accessible interfaces every day.
            </p>
            <div className="lp-section__body">
              <dl className="lp-defs">
                {principles.map((p) => (
                  <div key={p.term}>
                    <dt>{p.term}</dt>
                    <dd>{p.detail}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          <section className="lp-section" aria-labelledby="lp-audit-heading">
            <h2 id="lp-audit-heading">See what it did, and why</h2>
            <p className="lp-section__intro">
              Every action is recorded in plain language, so you never have to
              wonder what happened to your mail.
            </p>
            <div className="lp-section__body">
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
                        <th scope="row">
                          {r.what}
                          <span className="lp-table__why">{r.why}</span>
                        </th>
                        <td className="lp-table__why-col">{r.why}</td>
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
            <h2 id="lp-cta-heading">Ready when you are</h2>
            <p>
              Sign up in minutes, then walk through accessible voice-guided
              onboarding at your pace.
            </p>
            <div className="lp-ctas">
              <Link href="/signup" className="btn btn--primary btn--lg">
                Sign up
              </Link>
              <Link href="/login" className="btn btn--signin btn--lg">
                Sign in
              </Link>
            </div>
          </section>
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
