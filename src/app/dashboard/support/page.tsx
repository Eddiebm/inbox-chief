import type { Metadata } from "next";
import { SupportForm } from "@/components/dashboard/support-form";

export const metadata: Metadata = {
  title: "Support",
};

export default function SupportPage() {
  return (
    <div className="dash-main">
      <header className="dash-page-header">
        <h1>Support</h1>
        <p>
          Send a support request. This form posts to a stub API and does not yet
          create a ticket in a live help desk.
        </p>
      </header>
      <SupportForm />
    </div>
  );
}
