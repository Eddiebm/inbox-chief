import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: `Privacy Policy — ${product.name}`,
  description: `How ${product.name} collects, uses, stores, and protects your data, including Google user data.`,
};

const LAST_UPDATED = "August 15, 2026";

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
              number (including a verified call-in number), password-derived
              authentication data, sessions, mailbox connection status, and
              OAuth or mailbox credentials.
            </li>
            <li>
              <strong>Synced mailbox data:</strong> messages and their metadata,
              including sender and recipient addresses, subject, date, provider
              identifiers, labels, read status, snippets or message bodies, and
              attachment names, types, sizes, and provider identifiers. We
              retrieve attachment bytes when needed to read supported
              attachments or when you route a file to your signed-in Downloads
              queue.
            </li>
            <li>
              <strong>Call-in activity:</strong> the caller phone number, call
              session identifiers and status, call turns or transcripts, start
              and end times, duration, cost and cost-breakdown metadata, and
              technical end reasons.
            </li>
            <li>
              <strong>Assistant and preference data:</strong> drafts, approval
              state, audit logs, support requests, voice settings, voice-learning
              choices, and accessibility preferences.
            </li>
            <li>
              <strong>Optional product analytics:</strong> analytics is off by
              default. If you opt in in Settings, the app sends basic usage
              events, currently page paths, to our own analytics endpoint. The
              current endpoint does not persist those events or load a
              third-party analytics SDK.
            </li>
          </ul>

          <h2>How we use information</h2>
          <ul>
            <li>
              To connect and sync a supported mailbox and present messages to
              you. Gmail sync covers Primary first and then the rest of the
              inbox; phone reading defaults to Primary unless you ask for
              another supported scope.
            </li>
            <li>
              To filter, categorize, summarize, and read email aloud, and to
              prepare drafts at your direction.
            </li>
            <li>
              To support outbound email where that feature is available. The
              product rule requires you to approve a draft and then separately
              confirm Send. Sync, call-in, and draft creation do not send email,
              and there is no automatic-send path.
            </li>
            <li>
              To verify callers, provide phone access to mailbox information,
              process call speech, and calculate call usage and costs.
            </li>
            <li>To operate, secure, and improve the service.</li>
          </ul>

          <h2>Voice calls</h2>
          <p>
            Phone calls are handled through VAPI. To provide a call, VAPI and
            the model, speech-to-text, and text-to-speech providers configured
            for that call may process call audio, transcripts, and the mailbox
            text needed for your request. Configured providers can include
            OpenAI, Deepgram, Cartesia, and ElevenLabs. The exact speech provider
            can vary with the voice setting and provider configuration. On a
            call, sending is available only after the assistant reads back the
            exact recipient, subject, and body and you explicitly confirm in a
            separate turn.
          </p>

          <h2>Google user data</h2>
          <p>
            When you connect a Gmail account, {product.name} requests only the
            scopes it needs:
          </p>
          <ul>
            <li>
              <code>gmail.readonly</code> — to read and sync messages, message
              bodies, labels, and attachment data so we can display, filter,
              summarize, read, and route requested attachments.
            </li>
            <li>
              <code>gmail.send</code> — reserved for a reply that you first
              approve and then separately confirm. It is not used by sync,
              call-in, or draft creation and is never used for automatic sends.
            </li>
          </ul>
          <p>
            Google Calendar is optional and connected separately. If you choose
            it, <code>calendar.readonly</code> is used only to read event times,
            titles, and locations. Inbox Chief does not request calendar write
            access.
          </p>

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
            , including the Limited Use requirements. We do not use Google user
            data for advertising or sell it. We transfer it only as necessary to
            provide or improve user-facing features, with user consent, for
            security purposes, or as required by law. Humans do not read Google
            user data unless we have your affirmative agreement to view specific
            data for support, doing so is necessary for security or legal
            compliance, or the data has been aggregated and anonymized for
            internal operations.
          </p>

          <h2>Other mailbox providers</h2>
          <p>
            When you connect another mailbox provider we support, such as
            Outlook or an IMAP mailbox, we process mailbox data for the same
            user-directed features. Outlook uses Microsoft OAuth and Graph.
            Yahoo, iCloud, and other IMAP connections use the mailbox server and
            app password or credential you provide. Availability depends on the
            provider being configured and reachable.
          </p>

          <h2>Storage, retention, and deletion</h2>
          <p>
            Synced mailbox data, drafts, account records, call records, and audit
            records may be retained while your account is active and for as long
            as needed to provide, secure, and operate the assistant. Attachment
            bytes routed to the Downloads queue are stored for up to 48 hours;
            expired items are removed when the queue is accessed. OAuth tokens
            and stored IMAP credentials are encrypted before database storage.
            You can revoke provider access in your Google or Microsoft account.
            You can also disconnect a mailbox in Settings; this clears its
            stored credentials and immediately stops sync and call-in reads.
          </p>
          <p>
            Settings produces a downloadable organization data export and lets
            the workspace owner schedule deletion after a seven-day cooling-off
            period. Scheduled deletion completes automatically after that
            period. Export links expire after 48 hours. You may also request
            help with export or deletion at{" "}
            <a href={`mailto:${product.supportEmail}`}>{product.supportEmail}</a>.
          </p>

          <h2>Sharing</h2>
          <p>
            We do not sell personal data. We disclose data to service providers
            only as needed for their role, and when required for security, legal
            compliance, or a transaction involving the service. Current
            provider categories include:
          </p>
          <ul>
            <li>Vercel for application hosting and delivery.</li>
            <li>Neon for the PostgreSQL database.</li>
            <li>
              Google for Gmail APIs, and Microsoft or the relevant mailbox
              operator when you connect those providers.
            </li>
            <li>
              VAPI for voice calls, together with its configured model,
              speech-to-text, and text-to-speech providers, which can include
              OpenAI, Deepgram, Cartesia, and ElevenLabs.
            </li>
            <li>Stripe when billing and paid-plan features are used.</li>
            <li>
              OCR.space or Google Cloud Vision only when optional OCR is
              configured and used to extract text from a supported attachment.
            </li>
          </ul>

          <h2>Support and operator access</h2>
          <p>
            An operator may access account data only to investigate or resolve a
            support issue you request, to protect the service or users, or when
            legally required. Technical administration does not automatically
            grant mailbox access.
          </p>

          <h2>Security</h2>
          <p>
            Connections to the service use TLS in transit. OAuth tokens and IMAP
            credentials are encrypted at the application layer before they are
            stored. The application uses authenticated sessions, tenant-scoped
            queries, and access controls intended to prevent one account from
            accessing another account&rsquo;s data. We do not claim that these
            measures eliminate all risk, and no online service is perfectly
            secure.
          </p>

          <h2>Your choices</h2>
          <ul>
            <li>
              Revoke mailbox access in your Google or Microsoft account and
              contact us to remove the connection from Inbox Chief.
            </li>
            <li>Opt in or out of product analytics in Settings.</li>
            <li>
              Initiate export or deletion workflows in Settings, or request and
              confirm completion by email.
            </li>
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
