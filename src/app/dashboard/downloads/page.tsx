import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { resolveUserMailboxScope } from "@/lib/mail/tenant-context";
import { product } from "@/lib/product";

export const metadata: Metadata = {
  title: `Downloads · ${product.name}`,
};

export default async function DownloadsPage() {
  const user = await getCurrentUser();
  if (!user || user.id === "mock_user") redirect("/login");
  const scope = await resolveUserMailboxScope(user.id);
  const downloads = scope
    ? await loadDownloads(scope, user.id)
    : [];

  return (
    <section aria-labelledby="downloads-heading">
      <header className="page-header">
        <h1 id="downloads-heading">Computer downloads</h1>
        <p>
          Attachments you routed from a phone call or Ask. Files stay here for
          48 hours and are available only while you are signed in.
        </p>
      </header>

      {downloads.length === 0 ? (
        <EmptyDownloads />
      ) : (
        <>
          <p role="status">
            {downloads.length} attachment{downloads.length === 1 ? "" : "s"} ready.
          </p>
          <ul className="download-list" aria-label="Attachments ready to download">
            {downloads.map((download) => (
              <li className="download-card" key={download.id}>
                <h2>{download.filename}</h2>
                <dl>
                  <div>
                    <dt>From email</dt>
                    <dd>
                      {download.emailSubject} — {download.fromAddress}
                    </dd>
                  </div>
                  <div>
                    <dt>Received</dt>
                    <dd>{formatDate(download.emailReceivedAt)}</dd>
                  </div>
                  <div>
                    <dt>Size</dt>
                    <dd>{formatBytes(download.byteSize)}</dd>
                  </div>
                  <div>
                    <dt>Available until</dt>
                    <dd>{formatDate(download.expiresAt)}</dd>
                  </div>
                </dl>
                <a
                  className="btn-primary"
                  href={`/api/downloads/${encodeURIComponent(download.id)}`}
                  download
                  aria-label={`Download ${download.filename}`}
                >
                  Download
                </a>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

async function loadDownloads(
  scope: { organizationId: string; workspaceId: string },
  userId: string,
) {
  const { getNodePrisma } = await import("@/lib/db-node");
  const prisma = getNodePrisma();
  return prisma.attachmentDelivery.findMany({
    where: {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      requestedById: userId,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      filename: true,
      byteSize: true,
      fromAddress: true,
      emailSubject: true,
      emailReceivedAt: true,
      expiresAt: true,
    },
  });
}

function EmptyDownloads() {
  return (
    <div className="empty-state" role="status">
      <h2>No attachments waiting</h2>
      <p>
        On a call or in Ask, say “send this attachment to my computer.” Then
        refresh this page.
      </p>
    </div>
  );
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
