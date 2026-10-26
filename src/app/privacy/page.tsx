import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { legal, subprocessors } from "@/lib/legal";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How ${product.name} collects, uses, stores, shares and protects your data, including Google user data, call data and your rights.`,
};

export default function PrivacyPage() {
  const name = product.name;
  return (
    <LegalPage
      title="Privacy Policy"
      subtitle={`Effective ${legal.effectiveDate}`}
    >
      <h2>Who we are</h2>
      <p>
        {name} is operated by {legal.entityName}, {legal.entityDescription}{" "}
        (&ldquo;we,&rdquo; &ldquo;us,&rdquo; &ldquo;our&rdquo;), {legal.mailingAddress}. We
        are the controller of personal data we collect through{" "}
        <a href={product.url}>{product.url}</a> and our phone and text services. For privacy
        questions or to use your rights, write to{" "}
        <a href={`mailto:${legal.privacyEmail}`}>{legal.privacyEmail}</a>.
      </p>

      <h2>The short version</h2>
      <ul>
        <li>We read your mail only to do what you ask: sort it, read it aloud, draft replies.</li>
        <li>Nothing is sent from your account unless you approve it and then separately confirm.</li>
        <li>We do not sell your personal data, and we do not use it for advertising.</li>
        <li>
          We do not use your mail, call content or Google data to train AI models, and we do not
          allow our providers to do so under our instructions.
        </li>
        <li>You can export or delete your data, and disconnect your mailbox, at any time.</li>
      </ul>

      <h2>Information we collect</h2>
      <ul>
        <li>
          <strong>Account data:</strong> name, email address, password-derived authentication data,
          verified call-in phone number, sessions, and mailbox connection status. OAuth tokens and
          stored mailbox credentials are kept encrypted.
        </li>
        <li>
          <strong>Mailbox data you connect:</strong> messages and their metadata (sender, recipients,
          subject, date, labels, read status, snippets or bodies) and attachment names, types and
          sizes. We retrieve attachment contents only when needed to read a supported attachment or
          when you route a file to your Downloads queue. If you connect a calendar, event times,
          titles and locations.
        </li>
        <li>
          <strong>Call and text data:</strong> the caller&rsquo;s phone number, call identifiers and
          status, start and end times, duration, cost metadata, transcripts, and, where enabled by
          our voice provider, call audio. We send setup and checkout links by text message.
        </li>
        <li>
          <strong>Assistant and preference data:</strong> drafts, approval state, audit logs,
          support requests, writing-style settings and your accessibility preferences.
        </li>
        <li>
          <strong>Billing data:</strong> plan, subscription and payment status. Card details are
          handled by Stripe; we do not store full card numbers.
        </li>
        <li>
          <strong>Technical data:</strong> standard server and security logs such as IP address,
          browser type and request times.
        </li>
        <li>
          <strong>Optional analytics:</strong> off by default. If you opt in, we record basic usage
          events, currently page paths, to our own endpoint. We load no third-party analytics
          software.
        </li>
      </ul>

      <h2>Sensitive information and accessibility data</h2>
      <p>
        {name} is built for people who may have disabilities, so your accessibility settings (for
        example screen-reader and voice-onboarding preferences) can reveal health-related
        information. We collect them only to provide the accessibility features you choose, we do
        not use them for any other purpose, and we do not share them except with the providers that
        deliver the feature. Your email may also contain sensitive information such as health,
        financial or legal details. We process it only to carry out your requests and treat it as
        sensitive. Where the law requires your consent for this processing, you give it by
        enabling the feature, and you can withdraw it by disabling the feature or deleting your
        account.
      </p>

      <h2>How we use information and why</h2>
      <ul>
        <li>
          <strong>To provide the service you request</strong> (contract): connect and sync your
          mailbox, categorise, summarise and read mail aloud, prepare drafts, and handle calls.
        </li>
        <li>
          <strong>To keep the service secure and reliable</strong> (legitimate interests): prevent
          abuse, debug, keep audit records, and enforce our terms.
        </li>
        <li>
          <strong>To bill you and meet legal duties</strong> (contract and legal obligation).
        </li>
        <li>
          <strong>To improve the service</strong> using aggregated or de-identified information
          (legitimate interests), and product analytics only if you opt in (consent).
        </li>
      </ul>
      <p>
        Sending mail is not part of any automated process. Sync, drafting and calls never send mail.
        Where sending is available, you must approve the draft and then confirm Send. On a call the
        assistant reads back the exact recipient, subject and body, and you must confirm in a
        separate turn.
      </p>

      <h2>Artificial intelligence</h2>
      <p>
        We use AI models to summarise, categorise, draft and speak. Their output can be wrong, so
        review anything before you rely on it. We send a model only the text needed for your
        request. We do not use your mail, drafts or call content to train or fine-tune models, and we
        instruct providers not to retain it for their own training. Our writing-style feature is
        optional, requires your explicit consent, stores only a greeting, signature and tone setting,
        and can be disabled, reset or deleted at any time. It does not create a voiceprint and we do
        not use voice recognition to identify you.
      </p>

      <h2>Voice calls, recording and text messages</h2>
      <p>
        Calls are handled through VAPI and the telephony, speech and language providers it uses for
        that call. Those providers process call audio, transcripts and the mailbox text needed for
        your request. We keep transcripts for {legal.retention.callTranscripts} days and call audio
        for {legal.retention.callAudio}. At the start of each call the assistant tells you it is an
        automated assistant and that the call may be recorded or transcribed. You are responsible
        for telling anyone else on the call, and for complying with laws about recording calls in
        your location. If you do not want a call processed, do not make it; every feature is also
        available in the web app.
      </p>
      <p>
        We send text messages only for account setup and checkout links you request. Reply STOP to
        opt out. Message and data rates may apply. We do not send marketing texts.
      </p>

      <h2>Google user data</h2>
      <p>When you connect Gmail, we request only the scopes we need:</p>
      <ul>
        <li>
          <code>gmail.readonly</code>: to read and sync messages, labels and attachment data so we
          can display, filter, summarise, read aloud and route attachments you request.
        </li>
        <li>
          <code>gmail.send</code>: used only for a reply you first approve and then separately
          confirm. Never used by sync, calls or drafting, and never for automatic sends.
        </li>
      </ul>
      <p>
        Google Calendar is optional and connected separately. We request only{" "}
        <code>calendar.readonly</code>, to read event times, titles and locations. We never request
        calendar write access.
      </p>
      <h3>Limited Use disclosure</h3>
      <p>
        {name}&rsquo;s use and transfer to any other app of information received from Google APIs
        will adhere to the{" "}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Google API Services User Data Policy
        </a>
        , including the Limited Use requirements. We do not sell Google user data, use it for
        advertising, or use it to develop, improve or train generalised AI or machine-learning
        models. We transfer it only as needed to provide user-facing features, with your consent,
        for security, or as the law requires. Humans do not read Google user data unless you
        affirmatively agree for specific data in a support request, it is necessary for security or
        legal compliance, or it has been aggregated and anonymised for internal operations.
      </p>

      <h2>Other mailbox providers</h2>
      <p>
        If you connect Outlook (Microsoft OAuth and Graph) or an IMAP mailbox such as Yahoo or
        iCloud, we process mailbox data for the same user-directed features. IMAP uses the app
        password or credential you provide, which we store encrypted.
      </p>

      <h2>Who we share information with</h2>
      <p>
        We do not sell personal data and we do not share it for cross-context behavioural
        advertising. We share data with service providers acting on our instructions, only as needed
        for their role:
      </p>
      <div className="lp-table-wrap">
        <table className="lp-table">
          <caption className="sr-only">Service providers and what they handle</caption>
          <thead>
            <tr>
              <th scope="col">Provider</th>
              <th scope="col">Purpose</th>
              <th scope="col">Data</th>
            </tr>
          </thead>
          <tbody>
            {subprocessors.map((s) => (
              <tr key={s.name}>
                <th scope="row">{s.name}</th>
                <td>{s.purpose}</td>
                <td>{s.data}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        We may also disclose information to comply with law or valid legal process, to protect rights,
        safety or security, or in a merger, acquisition or sale of assets, in which case we will
        require the recipient to honour this policy and will tell you first.
      </p>

      <h2>Where data is processed</h2>
      <p>
        We host data in {legal.dataRegion}. Our providers may process data in the United States and
        other countries. When we transfer personal data from the European Economic Area, the United
        Kingdom or Switzerland, we rely on an adequacy decision or on the European Commission&rsquo;s
        Standard Contractual Clauses with the UK addendum, as applicable.
      </p>

      <h2>How long we keep information</h2>
      <div className="lp-table-wrap">
        <table className="lp-table">
          <caption className="sr-only">Retention periods</caption>
          <thead>
            <tr>
              <th scope="col">Data</th>
              <th scope="col">How long</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Account data</th>
              <td>While your account is active, then {legal.retention.accountAfterDeletion} days after deletion</td>
            </tr>
            <tr>
              <th scope="row">Synced mailbox data</th>
              <td>
                While the mailbox is connected. Disconnecting stops sync and call reads and clears
                stored credentials; synced copies are deleted within {legal.retention.mailAfterDisconnect} days
              </td>
            </tr>
            <tr>
              <th scope="row">Files in your Downloads queue</th>
              <td>Up to 48 hours</td>
            </tr>
            <tr>
              <th scope="row">Data export links</th>
              <td>48 hours</td>
            </tr>
            <tr>
              <th scope="row">Call transcripts</th>
              <td>{legal.retention.callTranscripts} days</td>
            </tr>
            <tr>
              <th scope="row">Call audio</th>
              <td>{legal.retention.callAudio}</td>
            </tr>
            <tr>
              <th scope="row">Audit logs</th>
              <td>{legal.retention.auditLogs} days</td>
            </tr>
            <tr>
              <th scope="row">Billing and tax records</th>
              <td>As long as tax and accounting law requires</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        The workspace owner can export data and schedule deletion in Settings. Deletion completes
        automatically after a seven-day cooling-off period. Backups are overwritten on their normal
        cycle. We may keep information longer where the law requires or to resolve a dispute.
      </p>

      <h2>Your rights</h2>
      <p>
        Depending on where you live, you may have the right to access your data, correct it, delete
        it, receive a portable copy, restrict or object to processing, withdraw consent, and not be
        discriminated against for using your rights. If you are in the European Economic Area or the
        United Kingdom you may also complain to your data protection authority. To use a right, email{" "}
        <a href={`mailto:${legal.privacyEmail}`}>{legal.privacyEmail}</a> or use Settings. We may need
        to verify your identity first. An authorised agent may act for you with your written
        permission. We respond within the time the law allows, normally within 30 to 45 days. If we
        decline a request you can appeal by replying to our response, and you may then contact your
        state attorney general.
      </p>

      <h2>California and other US state notices</h2>
      <p>
        In the past 12 months we collected the categories of personal information described above
        (identifiers, commercial information, internet activity, communications content, audio,
        sensitive information such as account log-in and accessibility-related data, and inferences
        in the form of draft preferences) from you, from mailbox providers you connect, and from our
        providers. We disclosed them for business purposes to the service providers listed above. We
        do not sell or share personal information as those terms are defined by the California
        Consumer Privacy Act, and we do not knowingly sell or share information of anyone under 16. We
        use sensitive information only to provide the service you request. We honour opt-out
        preference signals such as Global Privacy Control, although we do not engage in sales or
        sharing that would require an opt-out.
      </p>

      <h2>Cookies and similar technology</h2>
      <p>
        We use a strictly necessary session cookie to keep you signed in, and your browser&rsquo;s local
        storage to remember accessibility settings. We use no advertising or cross-site tracking
        cookies. Optional analytics is off unless you turn it on.
      </p>

      <h2>Children</h2>
      <p>
        {name} is for adults. You must be at least 18 to use it. We do not knowingly collect personal
        information from anyone under 18. If you believe a child has given us information, contact us
        and we will delete it.
      </p>

      <h2>Security</h2>
      <p>
        We use TLS in transit, application-layer encryption for OAuth tokens and IMAP credentials,
        authenticated sessions, tenant-scoped data access and audit logging. No system is perfectly
        secure. If a breach affects your personal data we will notify you and regulators as the law
        requires, without undue delay.
      </p>

      <h2>Operator access</h2>
      <p>
        We access an account only to resolve a support issue you request, to protect the service or
        its users, or where the law requires. Technical administration does not by itself grant access
        to your mailbox content.
      </p>

      <h2>Changes to this policy</h2>
      <p>
        We will post updates here with a new effective date. For material changes we will notify you by
        email or in the app before they take effect, and where the law requires we will ask for your
        consent.
      </p>

      <h2>Contact</h2>
      <p>
        {legal.entityName}, {legal.mailingAddress}.{" "}
        <a href={`mailto:${legal.privacyEmail}`}>{legal.privacyEmail}</a>.
      </p>
    </LegalPage>
  );
}
