import type { Metadata } from "next";
import { MailboxConnectPanel } from "@/components/mail/mailbox-connect-panel";
import { CallCostsTally } from "@/components/call-in/call-costs-tally";
import { CallInPhoneForm } from "@/components/call-in/call-in-phone-form";
import { CallInReadinessBanner } from "@/components/call-in/call-in-readiness-banner";
import { CallInVoiceSettings } from "@/components/call-in/call-in-voice-settings";
import { EmailCallAlertSettings } from "@/components/call-in/email-call-alert-settings";
import { OperatorHealthBanner } from "@/components/admin/operator-health-banner";
import { AccountDataPanel } from "@/components/settings/account-data-panel";
import { AnalyticsPrivacyPanel } from "@/components/settings/analytics-privacy-panel";
import { OperatorSetupPanel } from "@/components/settings/operator-setup-panel";
import { TeamInvitePanel } from "@/components/settings/team-invite-panel";
import { AccessibilityControls } from "@/components/a11y/accessibility-controls";
import { VoiceLearningPanel } from "@/components/settings/voice-learning-panel";
import { CalendarConnectPanel } from "@/components/settings/calendar-connect-panel";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: "Settings",
};

export default function SettingsPage() {
  return (
    <div className="dashboard-page">
      <header className="page-header">
        <h1>Settings</h1>
        <p>
          Manage mailbox connection, call-in phone, voice, team invites, privacy,
          accessibility, and assistant preferences for {product.name}.
        </p>
      </header>
      <OperatorHealthBanner />
      <CallInReadinessBanner />
      <OperatorSetupPanel />
      <MailboxConnectPanel />
      <CalendarConnectPanel />
      <CallInPhoneForm />
      <EmailCallAlertSettings />
      <CallInVoiceSettings />
      <CallCostsTally />
      <TeamInvitePanel />
      <VoiceLearningPanel />
      <AnalyticsPrivacyPanel />
      <AccessibilityControls variant="panel" />
      <AccountDataPanel />
      <section aria-labelledby="prefs-heading" className="settings-block">
        <h2 id="prefs-heading">Assistant preferences</h2>
        <p>
          Preferred name, tone, and quiet hours can be adjusted later from your
          dashboard. Call-in and Ask by voice work anytime from{" "}
          <a href="/dashboard/call-in">Call in</a>.
        </p>
      </section>
    </div>
  );
}
