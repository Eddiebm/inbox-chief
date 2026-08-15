import { product } from "./product";

/** Canonical permission keys — mailbox-scoped where noted */
export const PERMISSIONS = [
  { key: "view_message_metadata", name: "View message metadata", mailbox: true },
  { key: "read_message_contents", name: "Read message contents", mailbox: true },
  { key: "organize_messages", name: "Organize messages", mailbox: true },
  { key: "apply_labels", name: "Apply labels", mailbox: true },
  { key: "generate_drafts", name: "Generate drafts", mailbox: true },
  { key: "edit_drafts", name: "Edit drafts", mailbox: true },
  { key: "request_approval", name: "Request approval", mailbox: true },
  { key: "approve_messages", name: "Approve messages", mailbox: true },
  { key: "send_approved_messages", name: "Send approved messages", mailbox: true },
  { key: "manage_follow_ups", name: "Manage follow-ups", mailbox: true },
  { key: "manage_contacts", name: "Manage contacts", mailbox: true },
  { key: "review_retention", name: "Review retention candidates", mailbox: true },
  { key: "move_to_trash", name: "Move approved messages to Trash", mailbox: true },
  { key: "export_audit", name: "Export audit records", mailbox: true },
  { key: "manage_integrations", name: "Manage integrations", mailbox: false },
  { key: "manage_billing", name: "Manage billing", mailbox: false },
  { key: "invite_revoke_members", name: "Invite or revoke team members", mailbox: false },
] as const;

export type PermissionKey = (typeof PERMISSIONS)[number]["key"];

export const ROLES = [
  {
    key: "workspace_owner",
    name: "Workspace Owner",
    grantsMailboxAccessByDefault: true,
    permissions: PERMISSIONS.map((p) => p.key),
  },
  {
    key: "mailbox_owner",
    name: "Mailbox Owner",
    grantsMailboxAccessByDefault: true,
    permissions: PERMISSIONS.filter((p) => p.mailbox || p.key === "invite_revoke_members").map(
      (p) => p.key,
    ),
  },
  {
    key: "executive_assistant",
    name: "Executive Assistant",
    grantsMailboxAccessByDefault: true,
    permissions: [
      "view_message_metadata",
      "read_message_contents",
      "organize_messages",
      "apply_labels",
      "generate_drafts",
      "edit_drafts",
      "request_approval",
      "manage_follow_ups",
      "manage_contacts",
    ] satisfies PermissionKey[],
  },
  {
    key: "correspondence_manager",
    name: "Correspondence Manager",
    grantsMailboxAccessByDefault: true,
    permissions: [
      "view_message_metadata",
      "read_message_contents",
      "organize_messages",
      "apply_labels",
      "generate_drafts",
      "edit_drafts",
      "request_approval",
      "approve_messages",
      "manage_follow_ups",
      "manage_contacts",
      "review_retention",
    ] satisfies PermissionKey[],
  },
  {
    key: "reviewer",
    name: "Reviewer",
    grantsMailboxAccessByDefault: true,
    permissions: [
      "view_message_metadata",
      "read_message_contents",
      "approve_messages",
      "request_approval",
    ] satisfies PermissionKey[],
  },
  {
    key: "read_only_auditor",
    name: "Read-Only Auditor",
    grantsMailboxAccessByDefault: true,
    permissions: [
      "view_message_metadata",
      "read_message_contents",
      "export_audit",
    ] satisfies PermissionKey[],
  },
  {
    key: "technical_administrator",
    name: "Technical Administrator",
    /** Must not receive mailbox access automatically */
    grantsMailboxAccessByDefault: false,
    permissions: [
      "manage_integrations",
      "manage_billing",
      "invite_revoke_members",
    ] satisfies PermissionKey[],
  },
] as const;

export const INDUSTRY_TEMPLATES = [
  {
    key: "general_executive",
    name: "General executive",
    description: "Prioritize leadership correspondence, scheduling, and investor or board threads.",
    suggestedCategories: ["Urgent", "Needs Reply", "Scheduling", "Investors", "Employees", "Low Priority"],
  },
  {
    key: "medical_healthcare",
    name: "Medical and healthcare",
    description: "Suggested categories for clinical and practice correspondence. Does not provide medical advice.",
    suggestedCategories: ["Urgent", "Medical", "Scheduling", "Clients", "Needs Reply", "Bills"],
  },
  {
    key: "scientific_academic",
    name: "Scientific and academic",
    description: "Research, teaching, and collaboration correspondence templates.",
    suggestedCategories: ["Urgent", "Needs Reply", "Scheduling", "Clients", "Travel", "Newsletters"],
  },
  {
    key: "legal",
    name: "Legal",
    description: "Matter and client correspondence organization. Does not provide legal conclusions.",
    suggestedCategories: ["Urgent", "Legal", "Clients", "Needs Reply", "Waiting for Response", "Bills"],
  },
  {
    key: "real_estate",
    name: "Real estate",
    description: "Transactions, showings, and client follow-ups.",
    suggestedCategories: ["Urgent", "Clients", "Scheduling", "Needs Reply", "Follow-up", "Travel"],
  },
  {
    key: "financial_services",
    name: "Financial services",
    description: "Client and compliance-sensitive correspondence. Does not provide financial advice.",
    suggestedCategories: ["Urgent", "Financial", "Clients", "Needs Reply", "Legal", "Low Priority"],
  },
  {
    key: "consulting",
    name: "Consulting",
    description: "Client delivery, proposals, and scheduling.",
    suggestedCategories: ["Urgent", "Clients", "Needs Reply", "Follow-up", "Scheduling", "Travel"],
  },
  {
    key: "nonprofit",
    name: "Nonprofit",
    description: "Donors, board, and program correspondence.",
    suggestedCategories: ["Urgent", "Investors", "Needs Reply", "Scheduling", "Employees", "Newsletters"],
  },
  {
    key: "small_business",
    name: "Small business",
    description: "Customers, vendors, and operations.",
    suggestedCategories: ["Urgent", "Customers", "Employees", "Bills", "Needs Reply", "Receipts"],
  },
  {
    key: "personal_family",
    name: "Personal and family correspondence",
    description: "Family, bills, travel, and personal admin.",
    suggestedCategories: ["Urgent", "Family", "Bills", "Travel", "Personal", "Low Priority"],
  },
] as const;

export const PROFESSIONAL_DISCLAIMER =
  `${product.name} organizes and drafts correspondence; it does not replace licensed professional judgment.`;
