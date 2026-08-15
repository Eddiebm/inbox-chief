import type { Metadata } from "next";
import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: `Reset password · ${product.name}`,
  description: `Set a new ${product.name} password from a reset link.`,
};

export default function ResetPasswordPage() {
  return (
    <>
      <a href="#main" className="skip-link">
        Skip to reset password
      </a>
      <SiteHeader />
      <main id="main" className="auth-main" tabIndex={-1}>
        <Suspense
          fallback={
            <p className="status-line" role="status">
              Loading password reset…
            </p>
          }
        >
          <ResetPasswordForm />
        </Suspense>
      </main>
      <SiteFooter />
    </>
  );
}
