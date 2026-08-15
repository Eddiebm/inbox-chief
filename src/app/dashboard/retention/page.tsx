import type { Metadata } from "next";
import { RetentionPanel } from "@/components/retention/retention-panel";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: `Retention · ${product.name}`,
};

export default function RetentionPage() {
  return <RetentionPanel />;
}
