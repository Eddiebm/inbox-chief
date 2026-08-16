"use client";

import { useEffect, useState } from "react";

type Contact = {
  id: string;
  email: string;
  displayName: string | null;
  nickname: string | null;
  messageCount: number;
};

export function ContactsPanel() {
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [status, setStatus] = useState("Loading contacts from your synced mail…");

  async function load() {
    const response = await fetch("/api/contacts");
    const data = (await response.json()) as { contacts?: Contact[] };
    setContacts(data.contacts ?? []);
    setStatus(
      data.contacts?.length
        ? `${data.contacts.length} contacts loaded from your mail.`
        : "No contacts found yet. Sync Gmail to build this list from real messages.",
    );
  }

  useEffect(() => {
    void load().catch(() => setStatus("Could not load contacts right now."));
  }, []);

  async function saveNickname(contact: Contact, nickname: string) {
    const response = await fetch("/api/contacts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: contact.id, nickname }),
    });
    if (!response.ok) {
      setStatus("Could not save that nickname.");
      return;
    }
    setContacts((current) =>
      current.map((item) =>
        item.id === contact.id ? { ...item, nickname: nickname || null } : item,
      ),
    );
    setStatus(nickname ? `Saved ${nickname} for ${contact.email}.` : `Removed nickname for ${contact.email}.`);
  }

  async function remove(contact: Contact) {
    const response = await fetch(`/api/contacts?id=${encodeURIComponent(contact.id)}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      setStatus("Could not delete that contact.");
      return;
    }
    setContacts((current) => current.filter((item) => item.id !== contact.id));
    setStatus(`Deleted ${contact.displayName || contact.email} from Contacts.`);
  }

  return (
    <div className="dashboard-page">
      <header className="page-header">
        <h1>Contacts</h1>
        <p>
          Built only from people already present in your synced mail. Add a
          nickname so call-in phrases like “email Mom” resolve safely.
        </p>
      </header>
      <p className="status-line" role="status" aria-live="polite">
        {status}
      </p>
      <ul className="drafts-list" aria-label="Mail contacts">
        {contacts.map((contact) => (
          <li key={contact.id} className="settings-block">
            <h2>{contact.displayName || contact.email}</h2>
            <p>{contact.email} · seen in {contact.messageCount} message{contact.messageCount === 1 ? "" : "s"}</p>
            <label>
              Voice nickname
              <input
                type="text"
                defaultValue={contact.nickname ?? ""}
                maxLength={80}
                onBlur={(event) => void saveNickname(contact, event.currentTarget.value.trim())}
              />
            </label>
            <button type="button" className="btn-secondary" onClick={() => void remove(contact)}>
              Delete contact
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
