import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: `Data Processing Agreement — ${product.name}`,
  description: `DPA placeholder for ${product.name}.`,
};

export default function DpaPage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <SiteHeader />
      <main id="main" className="page legal-page">
        <header className="page-header">
          <h1>Data Processing Agreement</h1>
          <p>Placeholder — not a binding DPA. Replace before launch.</p>
        </header>
        <article className="legal-prose">
          <p>
            Business customers will receive a signed Data Processing Agreement
            covering roles, subprocessors, security measures, and audit rights
            for {product.name}.
          </p>
          <h2>This draft will include</h2>
          <ul>
            <li>Controller / processor roles</li>
            <li>Categories of personal data processed</li>
            <li>Security and confidentiality commitments</li>
            <li>Subprocessor disclosure and change notice</li>
            <li>Assistance with data subject requests</li>
          </ul>
          <p>
            Contact sales after signup if you need an executed DPA for your
            organization.
          </p>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
