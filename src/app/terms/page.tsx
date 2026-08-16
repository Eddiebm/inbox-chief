import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: `Terms of Service — ${product.name}`,
  description: `The terms that govern your use of ${product.name}.`,
};

const LAST_UPDATED = "August 15, 2026";

export default function TermsPage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <SiteHeader />
      <main id="main" className="page legal-page">
        <header className="page-header">
          <h1>Terms of Service</h1>
          <p>Last updated: {LAST_UPDATED}</p>
        </header>
        <article className="legal-prose">
          <p>
            These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and
            use of {product.name} (the &ldquo;Service&rdquo;) at{" "}
            <a href={product.url}>{product.url}</a>. By creating an account or
            using the Service, you agree to these Terms.
          </p>

          <h2>The Service</h2>
          <p>
            {product.name} is an accessibility-first assistant that helps you
            read, organize, and respond to your email, including by phone
            call-in. You connect your own mailbox and stay in control of it.
          </p>

          <h2>Your account</h2>
          <ul>
            <li>You must provide accurate information and keep it current.</li>
            <li>
              You are responsible for activity under your account and for keeping
              your credentials secure.
            </li>
            <li>You must be legally able to enter into these Terms.</li>
          </ul>

          <h2>Human approval and outbound email</h2>
          <p>
            {product.name} <strong>does not send email automatically</strong>.
            Where outbound sending is available, it requires you to approve the
            draft and then separately confirm Send. Call-in, mailbox sync, and
            draft creation do not send email. You are responsible for content
            you approve and send.
          </p>

          <h2>Acceptable use</h2>
          <ul>
            <li>Do not use the Service for unlawful, harmful, or abusive purposes.</li>
            <li>Do not attempt to disrupt, reverse engineer, or misuse the Service.</li>
            <li>Do not use the Service to send spam or violate others&rsquo; rights.</li>
          </ul>

          <h2>Plans, billing, and cancellation</h2>
          <p>
            Paid plans are billed on a recurring basis and include usage limits
            (such as call-in minutes). You can cancel at any time; access
            continues through the end of the current billing period. Fees are
            non-refundable except where required by law.
          </p>

          <h2>Third-party services</h2>
          <p>
            The Service integrates with third parties such as Google. Your use of
            those services is subject to their terms, and access may depend on
            permissions you grant. See our{" "}
            <a href="/privacy">Privacy Policy</a> for how we handle data.
          </p>

          <h2>Disclaimers and liability</h2>
          <p>
            The Service is provided &ldquo;as is&rdquo; without warranties of any
            kind. To the maximum extent permitted by law, {product.name} is not
            liable for indirect, incidental, or consequential damages, and our
            total liability is limited to the amount you paid for the Service in
            the twelve months before the claim.
          </p>

          <h2>Changes and termination</h2>
          <p>
            We may update these Terms or the Service. If changes are material, we
            will provide notice. We may suspend or terminate access for violations
            of these Terms. You may stop using the Service at any time and may
            request account deletion through Settings or by contacting us.
          </p>

          <h2>Contact</h2>
          <p>
            Questions about these Terms? Email{" "}
            <a href={`mailto:${product.supportEmail}`}>{product.supportEmail}</a>.
          </p>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
