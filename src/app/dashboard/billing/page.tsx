import type { Metadata } from "next";
import { BillingPanel } from "@/components/billing/billing-panel";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: `Billing · ${product.name}`,
};

export default function BillingPage() {
  return <BillingPanel />;
}
