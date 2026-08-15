import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { LoginForm } from "@/components/login-form";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: `Sign in · ${product.name}`,
  description: `Sign in to ${product.name}`,
};

export default function LoginPage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to sign in
      </a>
      <SiteHeader />
      <main id="main" className="auth-main" tabIndex={-1}>
        <LoginForm />
      </main>
      <SiteFooter />
    </>
  );
}
