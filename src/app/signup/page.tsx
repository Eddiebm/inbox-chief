import type { Metadata } from "next";
import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SignupForm } from "@/components/signup-form";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: `Sign up — ${product.name}`,
  description: `Create a secure ${product.name} account.`,
};

export default function SignupPage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to main content
      </a>
      <SiteHeader />
      <main id="main" className="page signup-page">
        <header className="page-header">
          <h1>Create your account</h1>
          <p>
            Secure signup for {product.name}. After you register, continue to
            accessible voice onboarding.
          </p>
        </header>

        <div className="signup-shell">
          <SignupForm />
          <p className="signup-alt">
            Already have an account?{" "}
            <Link href="/login">Sign in</Link>
          </p>
          <p className="signup-alt">
            Prefer to explore setup first?{" "}
            <Link href="/onboarding">Go to onboarding</Link>
          </p>
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
