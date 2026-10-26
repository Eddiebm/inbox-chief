import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { legal } from "@/lib/legal";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: `The terms that govern your use of ${product.name}, including AI, calls, billing and dispute resolution.`,
};

export default function TermsPage() {
  const name = product.name;
  return (
    <LegalPage
      title="Terms of Service"
      subtitle={`Effective ${legal.effectiveDate}`}
    >
      <p>
        <strong>
          Please read these Terms carefully. They include an agreement to resolve disputes by
          individual binding arbitration and a waiver of class actions (Section 19), and limits on our
          liability (Section 16). You can opt out of arbitration within 30 days.
        </strong>
      </p>

      <h2>1. Agreement</h2>
      <p>
        These Terms of Service (&ldquo;Terms&rdquo;) are a contract between you and{" "}
        {legal.entityName}, {legal.entityDescription} (&ldquo;we,&rdquo; &ldquo;us&rdquo;). They govern
        your use of {name}, at <a href={product.url}>{product.url}</a>, and our phone, text and related
        services (the &ldquo;Service&rdquo;). By creating an account, ticking the acceptance box, or
        using the Service, you agree to these Terms and to our{" "}
        <a href="/privacy">Privacy Policy</a>. If you do not agree, do not use the Service. If you use
        the Service for an organisation, you confirm you may bind it and &ldquo;you&rdquo; includes it.
      </p>

      <h2>2. Eligibility</h2>
      <p>
        You must be at least 18 years old and able to form a binding contract. You may not use the
        Service if you are barred from doing so by law or if we previously terminated your account for
        a violation.
      </p>

      <h2>3. What the Service is, and is not</h2>
      <p>
        {name} is an AI-assisted tool that helps you read, organise and respond to your own email,
        including by phone. It is <strong>not a human assistant, and it is not advice</strong> of any
        kind, including legal, medical, financial or safety advice. AI output can be inaccurate,
        incomplete, out of date or misleading, and it can misread, omit or mis-summarise a message,
        including amounts, dates and names. You must review what the Service tells you and drafts for
        you. <strong>Do not rely on the Service as your only means of receiving time-critical,
        medical, legal, financial or emergency communications.</strong> It is not an emergency
        service. We do not guarantee that it will be uninterrupted, error-free or available at any
        particular time.
      </p>

      <h2>4. Your account</h2>
      <ul>
        <li>Give accurate information and keep it current.</li>
        <li>
          Keep your credentials secure. You are responsible for activity under your account until you
          tell us it has been compromised.
        </li>
        <li>Tell us promptly at the address below if you suspect unauthorised access.</li>
      </ul>

      <h2>5. Your mailbox and your authority</h2>
      <p>
        You represent that you own the mailbox you connect, or that you are authorised by its owner
        and by any employer or organisation whose policies apply. You are responsible for complying
        with laws and policies that apply to your communications, including confidentiality duties,
        employer rules and rules about recording calls. The Service is not designed for regulated
        health or financial records, and we are not your business associate or processor of such
        records unless we have agreed in a signed writing.
      </p>

      <h2>6. Human approval and outbound email</h2>
      <p>
        {name} <strong>does not send email automatically</strong>. Where sending is available, you must
        approve the draft and then separately confirm Send. Sync, drafting and calls do not send mail.
        You are solely responsible for every message you approve and send, and for its content and
        recipients.
      </p>

      <h2>7. Your content and our licence</h2>
      <p>
        You keep all rights in your emails, attachments, drafts and other content
        (&ldquo;Your Content&rdquo;). You give us a limited, worldwide, non-exclusive licence to host,
        copy, process, transmit and display Your Content, and to have our service providers do so, only
        as needed to provide the Service to you, keep it secure, and comply with law. We do not use
        Your Content to train AI models. You are responsible for Your Content and confirm you have the
        rights to give us this licence.
      </p>

      <h2>8. Acceptable use</h2>
      <ul>
        <li>No unlawful, harmful, fraudulent, harassing or abusive use.</li>
        <li>No sending spam, bulk unsolicited messages, or messages that violate others&rsquo; rights.</li>
        <li>No attempt to disrupt, probe, scrape, reverse engineer or bypass limits or security.</li>
        <li>No use to build a competing product or to resell the Service without our written consent.</li>
        <li>No use that violates export, sanctions or telecommunications laws.</li>
      </ul>

      <h2>9. Calls and text messages</h2>
      <p>
        By using call-in you authorise us and our providers to process the call as described in the
        Privacy Policy. Calls may be recorded or transcribed, and the assistant will say so at the
        start of a call. You are responsible for anyone else on your end of the call. By giving us your
        phone number you consent to receive text messages containing setup and checkout links you
        request. Reply STOP to opt out. Message and data rates may apply. Call-in minutes are limited
        by your plan; there is no unlimited calling.
      </p>

      <h2>10. Trials, plans and billing</h2>
      <ul>
        <li>
          <strong>Trial.</strong> New accounts may receive a free trial. At the end of the trial, paid
          features stop unless you choose a paid plan. We do not charge you for a plan you have not
          selected.
        </li>
        <li>
          <strong>Subscriptions renew automatically.</strong> When you choose a paid plan, you
          authorise us and Stripe to charge your payment method each billing period until you cancel.
          Plan prices and included call-in minutes are shown on our pricing page at the time you
          subscribe.
        </li>
        <li>
          <strong>Prepaid minute packs</strong> are one-time purchases of additional call-in minutes.
          Purchased minutes roll over until used and are non-refundable except where the law requires.
          When included and purchased minutes run out, call-in stops until you buy more, upgrade, or
          your next period begins. We do not charge overage.
        </li>
        <li>
          <strong>Price changes.</strong> We will give you at least 30 days&rsquo; notice by email or
          in the app before a change to your recurring price takes effect. If you do not cancel
          before it takes effect, you accept the new price.
        </li>
        <li>
          <strong>Cancellation.</strong> You can cancel any time in Settings or by emailing us.
          Cancellation takes effect at the end of the current billing period, and access continues
          until then.
        </li>
        <li>
          <strong>Refunds.</strong> Fees are non-refundable except where the law requires or we
          decide otherwise in writing. Nothing here limits statutory refund or cancellation rights.
        </li>
        <li>
          <strong>Taxes.</strong> Prices exclude taxes unless stated. You are responsible for
          applicable taxes.
        </li>
      </ul>

      <h2>11. Third-party services</h2>
      <p>
        The Service works with third parties such as Google, Microsoft, Twilio, VAPI and Stripe. Your
        use of them is governed by their terms and privacy policies, and their availability and
        changes are outside our control. We are not responsible for them. You may revoke our access to
        your Google or Microsoft account at any time in that account&rsquo;s settings.
      </p>

      <h2>12. Our intellectual property and feedback</h2>
      <p>
        We and our licensors own the Service, its software, design and content, other than Your
        Content. We grant you a limited, revocable, non-transferable licence to use it for its
        intended purpose under these Terms. If you send us feedback, you give us a perpetual,
        royalty-free right to use it without obligation to you.
      </p>

      <h2>13. Privacy</h2>
      <p>
        Our <a href="/privacy">Privacy Policy</a> explains how we handle personal data. If you are a
        business customer, our <a href="/dpa">Data Processing Agreement</a> applies to personal data we
        process for you.
      </p>

      <h2>14. Suspension and termination</h2>
      <p>
        We may suspend or end your access immediately if you breach these Terms, if required by law, or
        to protect the Service or other people. You may stop using the Service at any time and may
        request deletion in Settings or by email. On termination, your licence ends, and Sections 7
        (as to our licence for retained backups), 12, 15 to 21 and 23 survive. Before we end access
        other than for serious or repeated breach, we will give you a chance to export your data.
      </p>

      <h2>15. Disclaimers</h2>
      <p>
        THE SERVICE IS PROVIDED &ldquo;AS IS&rdquo; AND &ldquo;AS AVAILABLE.&rdquo; TO THE MAXIMUM
        EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, INCLUDING
        MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, TITLE, NON-INFRINGEMENT, AND ANY WARRANTY
        THAT AI OUTPUT WILL BE ACCURATE, COMPLETE OR RELIABLE, OR THAT THE SERVICE WILL BE
        UNINTERRUPTED, SECURE OR ERROR-FREE. SOME JURISDICTIONS DO NOT ALLOW CERTAIN DISCLAIMERS, SO
        SOME OF THESE MAY NOT APPLY TO YOU.
      </p>

      <h2>16. Limitation of liability</h2>
      <p>
        TO THE MAXIMUM EXTENT PERMITTED BY LAW, WE AND OUR AFFILIATES, OFFICERS, EMPLOYEES, AND
        SUPPLIERS WILL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, EXEMPLARY OR
        PUNITIVE DAMAGES, OR FOR LOST PROFITS, REVENUE, DATA, GOODWILL OR OPPORTUNITIES, OR FOR ANY
        LOSS ARISING FROM A MISSED, DELAYED, MISREAD OR MIS-SUMMARISED MESSAGE, EVEN IF ADVISED OF THE
        POSSIBILITY. OUR TOTAL LIABILITY FOR ALL CLAIMS RELATING TO THE SERVICE WILL NOT EXCEED THE
        GREATER OF THE AMOUNT YOU PAID US IN THE TWELVE MONTHS BEFORE THE CLAIM AND ONE HUNDRED US
        DOLLARS. THESE LIMITS DO NOT EXCLUDE LIABILITY THAT CANNOT BE EXCLUDED BY LAW, INCLUDING FOR
        FRAUD, GROSS NEGLIGENCE, WILLFUL MISCONDUCT, OR DEATH OR PERSONAL INJURY CAUSED BY NEGLIGENCE.
      </p>

      <h2>17. Indemnification</h2>
      <p>
        You will defend and indemnify us and our affiliates, officers, employees and suppliers against
        claims, losses and expenses (including reasonable legal fees) arising from Your Content, your
        misuse of the Service, your breach of these Terms or of law, or messages you approve and send.
        This does not apply to the extent the law prohibits it for consumers.
      </p>

      <h2>18. Informal resolution</h2>
      <p>
        Before starting a claim, write to <a href={`mailto:${legal.legalEmail}`}>{legal.legalEmail}</a>{" "}
        with your name, account email and a description of the dispute and what you want. We will try to
        resolve it within 30 days. Both of us agree to try in good faith before filing anything.
      </p>

      <h2>19. Binding individual arbitration and class action waiver</h2>
      <p>
        If we cannot resolve a dispute informally, you and we agree to resolve it only by binding
        arbitration administered by the American Arbitration Association under its Consumer Arbitration
        Rules, except that either of us may bring an individual claim in small-claims court, and either
        may seek injunctive relief in court for infringement of intellectual property or misuse of the
        Service. Arbitration will be conducted by video or in writing unless the arbitrator decides an
        in-person hearing is needed, and the arbitrator applies the law of the state in Section 20.{" "}
        <strong>
          You and we each waive the right to a jury trial and to participate in a class, collective or
          representative action. Claims may be brought only individually.
        </strong>{" "}
        The arbitrator may not consolidate claims or award class relief. If this waiver is found
        unenforceable as to a claim, that claim will proceed in court and not in arbitration. A court,
        not the arbitrator, decides whether the waiver is enforceable. We will pay the arbitration fees
        that the AAA rules assign to a business for claims within its consumer rules. <strong>Opt out:</strong>{" "}
        you may opt out of this Section by emailing <a href={`mailto:${legal.legalEmail}`}>{legal.legalEmail}</a>{" "}
        within 30 days of first accepting these Terms, stating that you opt out. If you opt out, Section
        20 still applies.
      </p>

      <h2>20. Governing law and venue</h2>
      <p>
        These Terms are governed by the laws of {legal.governingState}, without regard to conflict-of-law
        rules, and the Federal Arbitration Act governs Section 19. Subject to Section 19, the state and
        federal courts located in {legal.venue} have exclusive jurisdiction, and you and we consent to
        them. Mandatory consumer protections of your home jurisdiction are not affected.
      </p>

      <h2>21. Time limit for claims</h2>
      <p>
        To the extent the law allows, any claim relating to the Service must be filed within one year
        after it arose, or it is permanently barred.
      </p>

      <h2>22. Changes to the Service and these Terms</h2>
      <p>
        We may change the Service and these Terms. For material changes we will give you at least 30
        days&rsquo; notice by email or in the app, and your continued use after the effective date means
        you accept them. If you do not accept, stop using the Service and cancel before the change
        takes effect. Changes to dispute resolution apply only to disputes arising after the change.
      </p>

      <h2>23. General</h2>
      <p>
        These Terms and the documents they reference are the entire agreement between us on their
        subject. If a provision is unenforceable, the rest remains in effect. Our failure to enforce a
        provision is not a waiver. You may not assign these Terms without our consent; we may assign
        them in a merger or sale. Neither of us is liable for delays caused by events beyond reasonable
        control. You consent to receive notices electronically. Nothing creates a partnership, agency
        or employment relationship.
      </p>

      <h2>24. Accessibility</h2>
      <p>
        We design {name} to meet WCAG 2.2 level AA and to work with keyboards, screen readers and
        voice. If you meet a barrier, tell us at{" "}
        <a href={`mailto:${legal.accessibilityEmail}`}>{legal.accessibilityEmail}</a> and we will work
        with you to provide the information or service another way.
      </p>

      <h2>25. Contact</h2>
      <p>
        {legal.entityName}, {legal.mailingAddress}.{" "}
        <a href={`mailto:${legal.legalEmail}`}>{legal.legalEmail}</a>.
      </p>
    </LegalPage>
  );
}
