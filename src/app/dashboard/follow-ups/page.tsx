import type { Metadata } from "next";
import { FollowUpsPanel } from "@/components/follow-ups/follow-ups-panel";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: `Follow-ups · ${product.name}`,
};

export default function FollowUpsPage() {
  return <FollowUpsPanel />;
}
