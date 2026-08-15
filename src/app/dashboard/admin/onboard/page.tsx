import type { Metadata } from "next";
import { AdminOnboardForm } from "@/components/admin/admin-onboard-form";
import { OperatorHealthBanner } from "@/components/admin/operator-health-banner";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: "Admin onboard",
};

/**
 * Operator-only patron onboard. Gated client-side via /api/auth/me isOperator
 * and server-side on POST /api/admin/onboard (OPERATOR_EMAILS).
 */
export default function AdminOnboardPage() {
  return (
    <div className="dashboard-page">
      <header className="page-header">
        <h1>Admin onboard</h1>
        <p>
          Add a blind patron to {product.name}: one screen for account, call-in
          phone, Gmail enable confirm, and invite helpers. Target five patrons
          without chaos.
        </p>
      </header>
      <OperatorHealthBanner />
      <AdminOnboardForm />
      <p>
        <a href="/dashboard/settings">Back to Settings</a>
      </p>
    </div>
  );
}
