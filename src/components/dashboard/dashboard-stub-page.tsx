import Link from "next/link";

type StubPageProps = {
  title: string;
  description: string;
  nextHint?: string;
};

export function DashboardStubPage({
  title,
  description,
  nextHint = "Connect a mailbox and finish setup to populate this view with live data.",
}: StubPageProps) {
  return (
    <div className="dash-main">
      <header className="dash-page-header">
        <h1>{title}</h1>
        <p>{description}</p>
      </header>
      <section
        className="dash-empty"
        aria-labelledby="empty-heading"
        role="status"
      >
        <h2 id="empty-heading" className="dash-empty__title">
          Nothing here yet
        </h2>
        <p className="dash-empty__body">{nextHint}</p>
        <p>
          <Link href="/dashboard" className="btn btn--ghost">
            Back to dashboard
          </Link>
        </p>
      </section>
    </div>
  );
}
