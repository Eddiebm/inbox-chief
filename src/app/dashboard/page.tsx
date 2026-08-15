import type { Metadata } from "next";
import { DashboardHome } from "@/components/dashboard/dashboard-home";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: "Dashboard",
  description: `Your ${product.name} overview — triage, drafts, approvals, and status.`,
};

export default function DashboardPage() {
  return <DashboardHome />;
}
