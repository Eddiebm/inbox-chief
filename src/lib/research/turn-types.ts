import type { CompletionRequest, CompletionResult, ProviderConfig } from "@/lib/research/providers";
import type { PublicationHit } from "@/lib/research/publications";
import type { ResearchStore } from "@/lib/research/store";

export type DeliveryResult =
  | { outcome: "provider_accepted"; providerMessageId: string }
  | { outcome: "failed"; code: string }
  | { outcome: "unknown"; code: string }
  | { outcome: "not_connected"; code: "gmail_reconnect" | "mailbox_missing" };

export type RecentMail = { id: string; from: string; subject: string; snippet: string; receivedAt: string };

export type TurnDeps = {
  now: Date;
  store: ResearchStore;
  configured: ProviderConfig[];
  complete: (request: CompletionRequest, config: ProviderConfig) => Promise<CompletionResult>;
  searchPublications: (query: string) => Promise<PublicationHit[]>;
  deliverEmail: (input: { to: string; subject: string; body: string }) => Promise<DeliveryResult>;
  readRecentMail: () => Promise<{ messages: RecentMail[]; reconnect: boolean }>;
  prepareDraft: (input: { recipient: string; subject: string; body: string }) => Promise<
    { ok: true; draftId: string; spoken: string } | { ok: false; spoken: string; code?: string }
  >;
  reviseDraft: (input: { draftId: string; body: string }) => Promise<{ ok: true } | { ok: false; spoken: string }>;
  sendDraft: (input: { draftId: string; confirmed: boolean }) => Promise<
    { ok: true; providerMessageId: string; spoken: string } | { ok: false; spoken: string; code?: string }
  >;
  appOrigin: string;
  timeZone?: string;
};
