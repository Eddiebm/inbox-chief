import type { Metadata } from "next";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Enter setup code",
};

export default async function ProvisionCodePage({
  searchParams,
}: {
  searchParams: Promise<{ code?: string }>;
}) {
  const { code } = await searchParams;
  if (code) {
    const normalized = code.trim().toUpperCase().replace(/[^A-Z2-9]/g, "");
    if (/^[A-Z2-9]{8}$/.test(normalized)) {
      redirect(`/provision/${normalized}`);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="provision-code-heading">
        <h1 id="provision-code-heading">Enter your setup code</h1>
        <p>
          Enter the eight-character code you heard on the phone. Letters are not
          case-sensitive.
        </p>
        <form action="/provision" method="get">
          <div className="form-field">
            <label htmlFor="provision-code">Setup code</label>
            <input
              id="provision-code"
              name="code"
              type="text"
              inputMode="text"
              autoCapitalize="characters"
              autoComplete="one-time-code"
              minLength={8}
              maxLength={11}
              required
              aria-describedby="provision-code-hint"
            />
            <p id="provision-code-hint">
              Example format: A B C D 2 3 4 5.
            </p>
          </div>
          <button className="btn-primary" type="submit">
            Continue
          </button>
        </form>
      </section>
    </main>
  );
}
