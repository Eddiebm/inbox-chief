import type { Metadata } from "next";
import { TalkHome } from "@/components/talk/talk-home";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: "Talk",
  description: `Ask ${product.name} by voice. The page asks what you want when it opens.`,
};

export default function TalkPage() {
  return <TalkHome />;
}
