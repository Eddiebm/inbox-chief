import type { Metadata } from "next";
import { product } from "@/lib/product";
import { OnboardingWizard } from "@/components/onboarding/OnboardingWizard";

export const metadata: Metadata = {
  title: "Onboarding",
  description: `Set up ${product.name} with voice or keyboard assistance.`,
};

export default function OnboardingPage() {
  return (
    <>
      <a href="#onboarding-main" className="skip-link">
        Skip to onboarding
      </a>
      <main id="onboarding-main" className="onboarding-page" tabIndex={-1}>
        <OnboardingWizard />
      </main>
    </>
  );
}
