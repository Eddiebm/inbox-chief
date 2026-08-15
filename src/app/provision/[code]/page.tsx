import type { Metadata } from "next";
import Link from "next/link";
import { findProvisioningByCode } from "@/lib/provisioning";

export const metadata: Metadata = {
  title: "Connect Gmail",
};

function maskEmail(email: string): string {
  const [local = "", domain = "gmail.com"] = email.split("@");
  const visible = local.slice(0, 2);
  return `${visible}${"•".repeat(Math.max(3, local.length - visible.length))}@${domain}`;
}

export default async function ProvisionPage({
  params,
  searchParams,
}: {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ reason?: string }>;
}) {
  const { code } = await params;
  const query = await searchParams;
  const provision = await findProvisioningByCode(code);

  if (!provision) {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="provision-heading">
          <h1 id="provision-heading">Code not found</h1>
          <p>Check the eight-character code and try again.</p>
          <Link href="/login">Sign in instead</Link>
        </section>
      </main>
    );
  }

  const waiting =
    provision.needsGoogleTestUser && !provision.googleTestUserEnabled;

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="provision-heading">
        <h1 id="provision-heading">
          {provision.provisionedReady ? "Gmail connected" : "Finish Gmail setup"}
        </h1>
        <p>
          Account: <strong>{maskEmail(provision.gmail)}</strong>
        </p>
        <p>
          Your phone is saved. Google requires one browser consent screen before
          Inbox Chief can read your Primary inbox.
        </p>

        {provision.provisionedReady ? (
          <>
            <p role="status">You are connected. Call and say “read my emails.”</p>
            <Link className="btn-primary" href="/dashboard">
              Open Inbox Chief
            </Link>
          </>
        ) : waiting ? (
          <>
            <p role="status" aria-live="polite">
              Your operator is enabling Gmail access. Return to this page after
              they confirm it; your account and phone are already saved.
            </p>
            {query.reason === "operator_pending" ? (
              <p>The connection link is ready, but operator approval is still pending.</p>
            ) : null}
          </>
        ) : (
          <>
            <p>
              The next page is Google. Choose this Gmail account and approve
              read access. Inbox Chief never sends email automatically.
            </p>
            <a
              className="btn-primary"
              href={`/api/provision/connect?code=${encodeURIComponent(provision.shortCode)}`}
            >
              Continue to Google
            </a>
          </>
        )}
      </section>
    </main>
  );
}
