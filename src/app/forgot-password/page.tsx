import type { Metadata } from "next";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: `Forgot password · ${product.name}`,
  description: `Reset your ${product.name} password, or ask Inbox Chief to set a temporary password.`,
};

export default function ForgotPasswordPage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to forgot password
      </a>
      <SiteHeader />
      <main id="main" className="auth-main" tabIndex={-1}>
        <ForgotPasswordForm />
      </main>
      <SiteFooter />
    </>
  );
}
