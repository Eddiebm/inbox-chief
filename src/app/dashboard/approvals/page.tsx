import type { Metadata } from "next";
import { ApprovalsPanel } from "@/components/approvals/approvals-panel";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: `Approvals · ${product.name}`,
};

export default function ApprovalsPage() {
  return <ApprovalsPanel />;
}
