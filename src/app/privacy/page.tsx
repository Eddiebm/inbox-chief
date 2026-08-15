import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: `Privacy Policy — ${product.name}`,
  description: `How ${product.name} collects, uses, stores, and protects your data, including Google user data.`,
};

const LAST_UPDATED = "August 14, 2026";

export default function PrivacyPage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <SiteHeader />
      <main id="main" className="page legal-page">
        <header className="page-header">
          <h1>Privacy Policy</h1>
          <p>Last updated: {LAST_UPDATED}</p>
        </header>
        <article className="legal-prose">
          <p>
            {product.name} (&ldquo;{product.name},&rdquo; &ldquo;we,&rdquo;
            &ldquo;us,&rdquo; or &ldquo;our&rdquo;) provides an accessibility-first
            assistant that helps you read, organize, and respond to your email.
            This Privacy Policy explains what information we collect, how we use
            it, how we protect it, and the choices you have. It applies to{" "}
            <a href={product.url}>{product.url}</a> and related services.
          </p>

          <h2>Information we collect</h2>
          <ul>
            <li>
              <strong>Account data:</strong> your name, email address, phone
              number (for call-in), and authentication details.
            </li>
            <li>
              <strong>Mailbox data:</strong> when you connect a mailbox, we access
              email messages, metadata, and attachments needed to sync,
              categorize, summarize, and — only with your explicit approval —
              send replies on your behalf.
            </li>
            <li>
              <strong>Assistant activity:</strong> logs of actions you approve,
              drafts, and voice/accessibility preferences.
            </li>
            <li>
              <strong>Optional product analytics:</strong> off by default; only
              collected if you opt in from Settings.
            </li>
          </ul>

          <h2>How we use information</h2>
          <ul>
            <li>To connect and sync your mailbox and present it to you.</li>
            <li>To categorize, summarize, and draft email at your direction.</li>
            <li>
              To send email <strong>only after you explicitly approve</strong>{" "}
              each message. We never send email automatically.
            </li>
            <li>To provide phone call-in access to your inbox.</li>
            <li>To operate, secure, and improve the service.</li>
          </ul>

          <h2>Google user data</h2>
          <p>
            When you connect a Gmail account, {product.name} requests only the
            scopes it needs:
          </p>
          <ul>
            <li>
              <code>gmail.readonly</code> — to read and sync your messages so we
              can display, categorize, and summarize them.
            </li>
            <li>
              <code>gmail.send</code> — to send a reply{" "}
              <strong>only after you approve it</strong>. This scope is never
              used to send mail automatically.
            </li>
          </ul>

          <h3>Limited Use disclosure</h3>
          <p>
            {product.name}&rsquo;s use and transfer of information received from
            Google APIs to any other app will adhere to the{" "}
            <a
              href="https://developers.google.com/terms/api-services-user-data-policy"
              target="_blank"
              rel="noopener noreferrer"
            >
              Google API Services User Data Policy
            </a>
            , including the Limited Use requirements. Specifically, we do not use
            Google user data for advertising, we do not sell Google user data, we
            do not transfer it except as necessary to provide or improve
            user-facing features (or as required by law), and we do not allow
            humans to read your data unless we have your affirmative consent for
            specific messages, it is necessary for security or to comply with
            law, or the data has been aggregated and anonymized.
          </p>

          <h2>Storage, retention, and deletion</h2>
          <p>
            We store the minimum data required to provide the service and retain
            it only as long as your account is active. OAuth tokens are stored
            encrypted and can be revoked at any time by disconnecting your
            mailbox in Settings or from your Google Account&rsquo;s security
            page. You may request export or deletion of your data by contacting
            us at{" "}
            <a href={`mailto:${product.supportEmail}`}>{product.supportEmail}</a>.
          </p>

          <h2>Sharing</h2>
          <p>
            We do not sell your personal data. We share data only with
            subprocessors that help us run the service (for example, hosting,
            email APIs, and voice providers), each under contractual
            confidentiality and data-protection obligations, or when required by
            law.
          </p>

          <h2>Security</h2>
          <p>
            We use encryption in transit and at rest, least-privilege access
            controls, and tenant isolation. No system is perfectly secure, but we
            work to protect your data and limit access to it.
          </p>

          <h2>Your choices</h2>
          <ul>
            <li>Disconnect a mailbox at any time in Settings.</li>
            <li>Revoke access from your Google Account security settings.</li>
            <li>Opt in or out of product analytics in Settings.</li>
            <li>Request data export or deletion by email.</li>
          </ul>

          <h2>Contact</h2>
          <p>
            Questions about this policy? Email{" "}
            <a href={`mailto:${product.supportEmail}`}>{product.supportEmail}</a>.
          </p>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
