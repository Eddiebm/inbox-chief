import type { Metadata } from "next";
import { DraftsPanel } from "@/components/drafts/drafts-panel";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: `Drafts · ${product.name}`,
};

export default function DraftsPage() {
  return <DraftsPanel />;
}
