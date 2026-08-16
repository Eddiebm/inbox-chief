import type { Metadata } from "next";
import { AskAnytimePanel } from "@/components/call-in/ask-anytime-panel";
import { CallCostsTally } from "@/components/call-in/call-costs-tally";
import { CallInReadinessBanner } from "@/components/call-in/call-in-readiness-banner";
import { CallInVoiceSettings } from "@/components/call-in/call-in-voice-settings";
import { EmailCallAlertSettings } from "@/components/call-in/email-call-alert-settings";
import { CallMinuteUsageBanner } from "@/components/call-in/call-minute-usage-banner";
import { OperatorHealthBanner } from "@/components/admin/operator-health-banner";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: `Call in · ${product.name}`,
  description: `Call or speak to ${product.name} anytime for mail status.`,
};

export default function CallInPage() {
  return (
    <div className="dashboard-page">
      <header className="page-header">
        <h1>Call in</h1>
        <p>
          Ask by voice on this page, or dial from your saved phone.{" "}
          {product.name} reads your Primary inbox aloud and never sends email
          from a call.
        </p>
      </header>
      <OperatorHealthBanner />
      <CallInReadinessBanner />
      <CallMinuteUsageBanner />
      <AskAnytimePanel />
      <EmailCallAlertSettings />
      <CallInVoiceSettings />
      <CallCostsTally />
    </div>
  );
}
