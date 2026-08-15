import { redirect } from "next/navigation";

/** Stable operator alias for the voice-signup queue. */
export default function AdminProvisioningPage() {
  redirect("/dashboard/admin/onboard#voice-provisioning-heading");
}
