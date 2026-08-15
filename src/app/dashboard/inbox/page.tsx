import type { Metadata } from "next";
import { InboxPanel } from "@/components/inbox/inbox-panel";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: `Inbox · ${product.name}`,
};

export default function InboxPage() {
  return <InboxPanel />;
}
