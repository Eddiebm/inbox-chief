"use client";

import { useEffect, useState } from "react";
import {
  DELETION_COOL_OFF_DAYS,
  EXPORT_EXPIRY_HOURS,
} from "@/lib/account/data-requests";
import { product } from "@/lib/product";

type SessionScope = {
  isMock: boolean;
  email: string | null;
  organizationId: string | null;
  message?: string;
};

/**
 * Settings panel: request a data export or schedule account deletion.
 * Uses real session org/email when available; never shows demo_org as the user's data.
 */
export function AccountDataPanel() {
  const [session, setSession] = useState<SessionScope | null>(null);
  const [exportStatus, setExportStatus] = useState(
    `Exports stay scoped to your organization and expire after ${EXPORT_EXPIRY_HOURS} hours.`,
  );
  const [deleteStatus, setDeleteStatus] = useState(
    `Account deletion uses a ${DELETION_COOL_OFF_DAYS}-day cooling-off period. Nothing is erased immediately.`,
  );
  const [deletionScheduled, setDeletionScheduled] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me");
        const data = (await res.json()) as {
          isMock?: boolean;
          email?: string | null;
          organizationId?: string | null;
          message?: string;
        };
        if (cancelled) return;
        setSession({
          isMock: Boolean(data.isMock),
          email: data.email ?? null,
          organizationId: data.organizationId ?? null,
          message: data.message,
        });
        if (!data.isMock && data.organizationId) {
          const deletionRes = await fetch("/api/account/delete");
          const deletion = (await deletionRes.json()) as {
            scheduled?: boolean;
            coolOffEndsAt?: string | null;
          };
          if (cancelled) return;
          setDeletionScheduled(Boolean(deletion.scheduled));
          if (deletion.scheduled && deletion.coolOffEndsAt) {
            setDeleteStatus(
              `Deletion is scheduled for ${new Date(deletion.coolOffEndsAt).toLocaleString()}. You can cancel it now.`,
            );
          }
        }
      } catch {
        if (!cancelled) {
          setSession({
            isMock: true,
            email: null,
            organizationId: null,
            message: "Demo session — connect a real account",
          });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const isMock = session?.isMock !== false;
  const accountEmail = session?.email ?? null;
  const organizationId = session?.organizationId ?? null;

  async function requestExport() {
    if (isMock || !organizationId) {
      setExportStatus(
        "Demo session — connect a real account to export your data.",
      );
      return;
    }
    setExportBusy(true);
    setExportStatus("Requesting export…");
    try {
      const res = await fetch("/api/account/export", {
        method: "POST",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        expiresAt?: string;
        downloadUrl?: string;
      };
      if (!res.ok || !data.ok) {
        setExportStatus(data.error ?? "Could not request a data export.");
        return;
      }
      setExportStatus(
        data.message ??
          `Export ready. Download expires ${data.expiresAt ? `around ${new Date(data.expiresAt).toLocaleString()}` : "in 48 hours"}.`,
      );
      if (data.downloadUrl) {
        const link = document.createElement("a");
        link.href = data.downloadUrl;
        link.download = "";
        document.body.appendChild(link);
        link.click();
        link.remove();
      }
    } catch {
      setExportStatus("Network error requesting export.");
    } finally {
      setExportBusy(false);
    }
  }

  async function scheduleDeletion() {
    if (isMock || !organizationId || !accountEmail) {
      setDeleteStatus(
        "Demo session — connect a real account to schedule deletion.",
      );
      return;
    }

    setDeleteBusy(true);
    setDeleteStatus("Scheduling deletion…");
    try {
      const res = await fetch("/api/account/delete", {
        method: "POST",
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
        coolOffEndsAt?: string;
      };
      if (!res.ok || !data.ok) {
        setDeleteStatus(data.error ?? "Could not schedule account deletion.");
        return;
      }
      setDeletionScheduled(true);
      setDeleteStatus(
        data.message ??
          (data.coolOffEndsAt
            ? `Deletion scheduled. Cooling-off ends ${new Date(data.coolOffEndsAt).toLocaleString()}.`
            : "Deletion scheduled."),
      );
    } catch {
      setDeleteStatus("Network error scheduling deletion.");
    } finally {
      setDeleteBusy(false);
    }
  }

  async function cancelDeletion() {
    setDeleteBusy(true);
    setDeleteStatus("Keeping your account…");
    try {
      const res = await fetch("/api/account/delete", { method: "DELETE" });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        message?: string;
      };
      if (!res.ok || !data.ok) {
        setDeleteStatus(data.error ?? "Could not cancel account deletion.");
        return;
      }
      setDeletionScheduled(false);
      setDeleteStatus(
        data.message ?? "Account deletion canceled. Your account will stay active.",
      );
    } catch {
      setDeleteStatus("Network error while keeping your account.");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <section
      className="settings-block account-data-panel"
      aria-labelledby="account-data-heading"
    >
      <h2 id="account-data-heading">Your data</h2>
      <p>
        Export a copy of your {product.name} data or schedule account deletion.
        Both actions stay scoped to your organization — never another tenant.
      </p>

      {isMock ? (
        <p className="status-line" role="status" aria-live="polite">
          Demo session — connect a real account
        </p>
      ) : null}

      <div className="account-data-section">
        <h3 id="export-heading">Data export</h3>
        <p>
          {isMock || !organizationId
            ? "Sign in with a real account to request an export of your organization data."
            : `Download your account, mailbox, mail metadata, contacts, and audit history. Links expire after ${EXPORT_EXPIRY_HOURS} hours.`}
        </p>
        <button
          type="button"
          className="btn-primary"
          disabled={exportBusy || isMock || !organizationId}
          aria-busy={exportBusy}
          onClick={() => void requestExport()}
        >
          {exportBusy ? "Preparing…" : "Download data export"}
        </button>
        <p className="status-line" role="status" aria-live="polite">
          {exportStatus}
        </p>
      </div>

      <div className="account-data-section account-data-danger">
        <h3 id="delete-heading">Delete account</h3>
        <p>
          {isMock || !accountEmail
            ? "Sign in with a real account to schedule deletion."
            : `One button schedules deletion. Your account stays active for ${DELETION_COOL_OFF_DAYS} days, and you can cancel during that time.`}
        </p>
        <button
          type="button"
          className={deletionScheduled ? "btn-primary" : "btn-danger"}
          disabled={deleteBusy || isMock || !organizationId}
          aria-busy={deleteBusy}
          onClick={() =>
            void (deletionScheduled ? cancelDeletion() : scheduleDeletion())
          }
        >
          {deleteBusy
            ? deletionScheduled
              ? "Keeping account…"
              : "Scheduling…"
            : deletionScheduled
              ? "Cancel deletion and keep my account"
              : "Schedule account deletion"}
        </button>
        <p className="status-line" role="status" aria-live="polite">
          {deleteStatus}
        </p>
      </div>
    </section>
  );
}
