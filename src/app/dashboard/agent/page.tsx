import type { Metadata } from "next";
import { AgentHome } from "@/components/research/agent-home";

export const metadata: Metadata = {
  title: "Research and notes",
  description: "Speak, research, save, and email a session without needing sighted help for the core controls.",
};

export default function ResearchAgentPage() {
  return <AgentHome />;
}
