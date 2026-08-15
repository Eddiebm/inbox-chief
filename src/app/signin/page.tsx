import { redirect } from "next/navigation";

type SigninPageProps = {
  searchParams: Promise<{ next?: string | string[] }>;
};

/** Alias for users who expect /signin — canonical auth is /login. */
export default async function SigninAliasPage({ searchParams }: SigninPageProps) {
  const params = await searchParams;
  const next = Array.isArray(params.next) ? params.next[0] : params.next;
  if (next && next.startsWith("/") && !next.startsWith("//")) {
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  redirect("/login");
}
