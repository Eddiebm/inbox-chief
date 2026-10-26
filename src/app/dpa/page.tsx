import type { Metadata } from "next";
import { LegalPage } from "@/components/legal/legal-page";
import { legal, subprocessors } from "@/lib/legal";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: "Data Processing Agreement",
  description: `The data processing terms that apply when ${product.name} processes personal data for a business customer.`,
};

export default function DpaPage() {
  const name = product.name;
  return (
    <LegalPage
      title="Data Processing Agreement"
      subtitle={`Effective ${legal.effectiveDate}`}
    >
      <p>
        This Data Processing Agreement (&ldquo;DPA&rdquo;) forms part of the agreement between{" "}
        {legal.entityName} (&ldquo;Processor,&rdquo; &ldquo;we&rdquo;) and the business customer that
        has subscribed to {name} under a plan that includes a DPA (&ldquo;Customer&rdquo;). It applies
        where we process Customer Personal Data as Customer&rsquo;s processor or service provider.
        Capitalised terms not defined here have the meanings in the Terms of Service or in Data
        Protection Law.
      </p>

      <h2>1. Definitions</h2>
      <p>
        &ldquo;Data Protection Law&rdquo; means laws applicable to the processing, including the EU and
        UK General Data Protection Regulation, the Swiss Federal Act on Data Protection, and US state
        privacy laws including the California Consumer Privacy Act. &ldquo;Customer Personal
        Data&rdquo; means personal data in Customer&rsquo;s mailbox, calls and account that we process
        on Customer&rsquo;s behalf. &ldquo;Subprocessor&rdquo; means a third party we engage to process
        Customer Personal Data.
      </p>

      <h2>2. Roles and scope</h2>
      <p>
        Customer is the controller (or processor, where acting for its own customer) and we are the
        processor (or sub-processor). Annex I describes the processing. Customer is responsible for the
        lawfulness of the Customer Personal Data and of its instructions, including having a lawful basis
        and giving any required notices to the people whose data is in connected mailboxes.
      </p>

      <h2>3. Instructions</h2>
      <p>
        We process Customer Personal Data only on Customer&rsquo;s documented instructions, which are the
        Terms, this DPA and Customer&rsquo;s use of the features, unless the law requires otherwise, in
        which case we will tell Customer first where the law permits. We will tell Customer if we
        believe an instruction infringes Data Protection Law. We do not use Customer Personal Data to
        train AI models.
      </p>

      <h2>4. Confidentiality</h2>
      <p>
        Everyone we authorise to process Customer Personal Data is bound by confidentiality duties and
        receives access only as needed for their role.
      </p>

      <h2>5. Security</h2>
      <p>
        We implement the technical and organisational measures in Annex II and review them regularly. We
        may update them provided overall protection is not materially reduced.
      </p>

      <h2>6. Subprocessors</h2>
      <p>
        Customer gives general authorisation for the Subprocessors in Annex III. We bind each by written
        terms with materially equivalent data protection obligations and remain responsible for their
        performance. We will give Customer at least 30 days&rsquo; notice of a new or replacement
        Subprocessor by email or in the app. Customer may object on reasonable data protection grounds
        within that period; if we cannot resolve the objection, Customer may terminate the affected
        service and receive a pro-rata refund of prepaid fees for the unused period.
      </p>

      <h2>7. International transfers</h2>
      <p>
        We may process Customer Personal Data in {legal.dataRegion} and in other countries where our
        Subprocessors operate. For transfers of personal data from the EEA, the UK or Switzerland to a
        country without an adequacy decision, the Standard Contractual Clauses (Commission Implementing
        Decision (EU) 2021/914) are incorporated by reference: Module Two where Customer is a
        controller and Module Three where Customer is a processor, with the following choices: clause 7
        docking clause included; clause 9(a) option 2, general authorisation with 30 days&rsquo; notice;
        clause 11 optional language omitted; clause 17 governed by the law of Ireland; clause 18 the
        courts of Ireland; Annexes I to III as set out below. For the UK, the UK International Data
        Transfer Addendum is incorporated, with the same details. For Switzerland, references to the
        GDPR include the Swiss Act and the competent authority is the Swiss FDPIC.
      </p>

      <h2>8. Data subject requests</h2>
      <p>
        We will promptly tell Customer of a request from an individual relating to Customer Personal
        Data and will not respond except as Customer instructs or the law requires. Taking into account
        the nature of the processing, we will help Customer respond using the export and deletion
        features and, where needed, reasonable additional assistance.
      </p>

      <h2>9. Personal data breach</h2>
      <p>
        We will notify Customer without undue delay and in any event within 72 hours after we confirm a
        personal data breach affecting Customer Personal Data, with the information we then have about
        its nature, likely consequences and measures taken, and we will keep Customer updated and take
        reasonable steps to contain and remediate it. Notification is not an admission of fault.
      </p>

      <h2>10. Assistance and impact assessments</h2>
      <p>
        We will give Customer reasonable help with data protection impact assessments and consultations
        with authorities relating to the processing, at Customer&rsquo;s cost where the help goes beyond
        what we provide to customers generally.
      </p>

      <h2>11. Audits</h2>
      <p>
        We will make available the information needed to show compliance with this DPA, including
        summaries of independent assessments we hold. If that is not sufficient to meet a legal
        requirement, Customer may audit us once a year, or after a confirmed breach, on 30 days&rsquo;
        written notice, during business hours, under confidentiality, without unreasonable disruption,
        and at Customer&rsquo;s cost, using an independent auditor bound by confidentiality.
      </p>

      <h2>12. Return and deletion</h2>
      <p>
        On termination, Customer may export its data in Settings. We will delete Customer Personal Data
        after the cooling-off period in the Privacy Policy and within {legal.retention.accountAfterDeletion}{" "}
        days of the end of the agreement, except where the law requires us to keep it, in which case we
        will protect it and process it only for that purpose. Backups are overwritten on their normal
        cycle.
      </p>

      <h2>13. California and other US state laws</h2>
      <p>
        We are Customer&rsquo;s service provider. We will not sell or share Customer Personal Data, retain,
        use or disclose it outside our direct business relationship or for any purpose other than the
        business purposes in this DPA, or combine it with other data except as the law permits. We will
        tell Customer if we can no longer meet our obligations, and Customer may take reasonable steps to
        stop and remediate unauthorised use. We certify that we understand and will comply with these
        restrictions.
      </p>

      <h2>14. Liability and precedence</h2>
      <p>
        Each party&rsquo;s liability under this DPA is subject to the limits in the Terms of Service, except
        where the law or the Standard Contractual Clauses do not allow it. If this DPA conflicts with the
        Terms about personal data, this DPA controls; if it conflicts with the Standard Contractual
        Clauses, the Clauses control.
      </p>

      <h2>Annex I. Description of processing</h2>
      <ul>
        <li>
          <strong>Data exporter / importer:</strong> Customer is the exporter. {legal.entityName},{" "}
          {legal.mailingAddress}, is the importer. Contact:{" "}
          <a href={`mailto:${legal.privacyEmail}`}>{legal.privacyEmail}</a>.
        </li>
        <li>
          <strong>Data subjects:</strong> Customer&rsquo;s users, and people who send mail to or receive
          mail from connected mailboxes, or take part in calls.
        </li>
        <li>
          <strong>Categories of data:</strong> contact details, mailbox content and metadata, calendar
          events, call audio and transcripts, phone numbers, account and accessibility preferences, and
          billing identifiers. Mailbox content may include sensitive categories that Customer chooses to
          place there; the Service is not designed for regulated health or financial records.
        </li>
        <li>
          <strong>Nature and purpose:</strong> hosting, syncing, categorising, summarising, reading aloud
          and drafting email at Customer&rsquo;s direction, and handling calls and messages.
        </li>
        <li>
          <strong>Frequency and duration:</strong> continuous while Customer uses the Service, until
          deletion under section 12.
        </li>
        <li>
          <strong>Competent supervisory authority:</strong> that of Customer&rsquo;s establishment in the EEA, or
          the Irish Data Protection Commission where Customer has none.
        </li>
      </ul>

      <h2>Annex II. Security measures</h2>
      <ul>
        <li>Encryption in transit with TLS for all connections to the service.</li>
        <li>Application-layer encryption of OAuth tokens and stored mailbox credentials before storage.</li>
        <li>Authenticated sessions and access controls; every data query is scoped to the customer&rsquo;s tenant.</li>
        <li>Support access to an account only for a requested issue, to protect the service, or where legally required.</li>
        <li>Audit logging of assistant actions and approvals.</li>
        <li>Tenant data export and scheduled deletion with a cooling-off period.</li>
        <li>Secrets managed outside source code, with production deployment blocked when configuration is incomplete.</li>
        <li>Providers selected for security practices, and bound by data protection terms.</li>
      </ul>

      <h2>Annex III. Authorised Subprocessors</h2>
      <div className="lp-table-wrap">
        <table className="lp-table">
          <caption className="sr-only">Authorised subprocessors</caption>
          <thead>
            <tr>
              <th scope="col">Subprocessor</th>
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
    </LegalPage>
  );
}
