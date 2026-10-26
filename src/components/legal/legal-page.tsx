import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

type LegalPageProps = {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
};

export function LegalPage({ title, subtitle, children }: LegalPageProps) {
  return (
    <div className="lp">
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <SiteHeader />
      <main id="main" className="page legal-page">
        <header className="page-header">
          <h1>{title}</h1>
          {subtitle ? <p>{subtitle}</p> : null}
        </header>
        <article className="legal-prose">{children}</article>
      </main>
      <SiteFooter />
    </div>
  );
}
