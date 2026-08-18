export const product = {
  name: process.env.NEXT_PUBLIC_PRODUCT_NAME ?? "Inbox Chief",
  tagline:
    process.env.NEXT_PUBLIC_PRODUCT_TAGLINE ??
    "Your secure AI-powered personal digital assistant.",
  promise:
    process.env.NEXT_PUBLIC_PRODUCT_PROMISE ??
    "Inbox Chief gives busy people the benefits of a trusted personal assistant without surrendering control of their email.",
  url:
    process.env.NEXT_PUBLIC_APP_URL ?? "https://inboxchief.email",
  supportEmail:
    process.env.NEXT_PUBLIC_SUPPORT_EMAIL ?? "eddie@bannermanmenson.com",
} as const;

export type Product = typeof product;
