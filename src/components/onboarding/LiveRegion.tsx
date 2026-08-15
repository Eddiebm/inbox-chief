"use client";

type LiveRegionProps = {
  message: string;
  /** Use assertive for spoken/listening status changes */
  politeness?: "assertive" | "polite";
};

/**
 * Screen-reader live region for status announcements.
 * Visually subtle but not fully clipped so sighted users get status text too.
 */
export function LiveRegion({
  message,
  politeness = "assertive",
}: LiveRegionProps) {
  return (
    <div
      role="status"
      aria-live={politeness}
      aria-atomic="true"
      className="onboarding-live-region"
    >
      {message}
    </div>
  );
}
