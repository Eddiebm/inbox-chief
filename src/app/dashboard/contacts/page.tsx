import type { Metadata } from "next";
import { ContactsPanel } from "@/components/contacts/contacts-panel";

export const metadata: Metadata = { title: "Contacts" };

export default function ContactsPage() {
  return <ContactsPanel />;
}
