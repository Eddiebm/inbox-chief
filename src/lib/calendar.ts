import { google } from "googleapis";
import { decryptSecret, encryptSecret } from "@/lib/crypto/token-encryption";
import { getNodePrisma } from "@/lib/db-node";
import { getGmailOAuthConfig } from "@/lib/gmail/config";
import { writeAuditLog } from "@/lib/audit";

export const GOOGLE_CALENDAR_READONLY_SCOPE =
  "https://www.googleapis.com/auth/calendar.readonly";
export const DEFAULT_CALENDAR_TIME_ZONE = "America/Chicago";
export const CALENDAR_NOT_CONNECTED_SPEECH =
  "Calendar isn't connected yet. You can connect it in Settings.";

type CalendarScope = {
  organizationId: string;
  workspaceId: string;
  userId: string;
};

function oauthClient() {
  const config = getGmailOAuthConfig();
  if (!config.ok) throw new Error(config.reason);
  return new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri,
  );
}

export function buildCalendarConsentUrl(state: string): string {
  return oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: false,
    scope: [GOOGLE_CALENDAR_READONLY_SCOPE],
    state,
  });
}

export async function connectCalendar(
  input: CalendarScope & { authorizationCode: string },
): Promise<void> {
  const client = oauthClient();
  const { tokens } = await client.getToken(input.authorizationCode);
  if (!tokens.access_token) throw new Error("calendar_token_exchange_failed");
  const prisma = getNodePrisma();
  const prior = await prisma.calendarConnection.findFirst({
    where: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      userId: input.userId,
    },
  });
  const refreshTokenEnc = tokens.refresh_token
    ? encryptSecret(tokens.refresh_token)
    : prior?.refreshTokenEnc;
  if (!refreshTokenEnc) throw new Error("calendar_refresh_token_missing");
  client.setCredentials(tokens);
  const calendar = google.calendar({ version: "v3", auth: client });
  const primary = await calendar.calendars.get({ calendarId: "primary" });
  await prisma.calendarConnection.upsert({
    where: { userId: input.userId },
    create: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      accessTokenEnc: encryptSecret(tokens.access_token),
      refreshTokenEnc,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scopes: (tokens.scope ?? GOOGLE_CALENDAR_READONLY_SCOPE).split(/\s+/),
      timeZone: primary.data.timeZone ?? DEFAULT_CALENDAR_TIME_ZONE,
    },
    update: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      accessTokenEnc: encryptSecret(tokens.access_token),
      refreshTokenEnc,
      expiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      scopes: (tokens.scope ?? GOOGLE_CALENDAR_READONLY_SCOPE).split(/\s+/),
      timeZone: primary.data.timeZone ?? DEFAULT_CALENDAR_TIME_ZONE,
    },
  });
  await writeAuditLog({
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    actorId: input.userId,
    action: "MANAGE_INTEGRATION",
    summary: "Connected optional Google Calendar read access",
    resourceType: "calendar_connection",
  });
}

export type CalendarRange = "today" | "tomorrow" | "next";

export function formatCalendarEventsSpeech(input: {
  range: CalendarRange;
  timeZone: string;
  events: Array<{
    summary?: string | null;
    location?: string | null;
    start?: { dateTime?: string | null; date?: string | null } | null;
  }>;
}): string {
  if (!input.events.length) {
    return input.range === "next"
      ? "You have no upcoming calendar events in the next seven days."
      : `You have no events on your calendar ${input.range}.`;
  }
  const spoken = input.events.map((event) => {
    const title = event.summary?.trim() || "Untitled event";
    const location = event.location?.trim();
    const rawStart = event.start?.dateTime;
    const time = rawStart
      ? new Intl.DateTimeFormat("en-US", {
          timeZone: input.timeZone,
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(rawStart))
      : "all day";
    return `${time}, ${title}${location ? `, at ${location}` : ""}`;
  });
  const intro =
    input.range === "next" ? "Your next event is" : `Your calendar ${input.range}:`;
  return `${intro} ${spoken.join(". ")}.`;
}

function zonedDateParts(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return { year: value("year"), month: value("month"), day: value("day") };
}

function dayBounds(range: Exclude<CalendarRange, "next">, timeZone: string) {
  const offsetDays = range === "tomorrow" ? 1 : 0;
  const target = new Date(Date.now() + offsetDays * 86_400_000);
  const parts = zonedDateParts(target, timeZone);
  const localMidnightUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
  );
  const zoneName = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "shortOffset",
  })
    .formatToParts(new Date(localMidnightUtc))
    .find((part) => part.type === "timeZoneName")?.value;
  const offsetMatch = zoneName?.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
  const offsetMinutes = offsetMatch
    ? (offsetMatch[1] === "+" ? 1 : -1) *
      (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3] ?? 0))
    : -6 * 60;
  const start = new Date(localMidnightUtc - offsetMinutes * 60_000);
  return {
    timeMin: start.toISOString(),
    timeMax: new Date(start.getTime() + 86_400_000).toISOString(),
  };
}

export async function getCalendarSpeech(
  input: CalendarScope & { range: CalendarRange },
): Promise<string> {
  const prisma = getNodePrisma();
  const connection = await prisma.calendarConnection.findFirst({
    where: {
      organizationId: input.organizationId,
      workspaceId: input.workspaceId,
      userId: input.userId,
    },
  });
  if (!connection) {
    return CALENDAR_NOT_CONNECTED_SPEECH;
  }
  const client = oauthClient();
  client.setCredentials({
    access_token: decryptSecret(connection.accessTokenEnc),
    refresh_token: decryptSecret(connection.refreshTokenEnc),
    expiry_date: connection.expiresAt?.getTime(),
  });
  const calendar = google.calendar({ version: "v3", auth: client });
  const timeZone = connection.timeZone || DEFAULT_CALENDAR_TIME_ZONE;
  const bounds =
    input.range === "next"
      ? {
          timeMin: new Date().toISOString(),
          timeMax: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        }
      : dayBounds(input.range, timeZone);
  const response = await calendar.events.list({
    calendarId: "primary",
    singleEvents: true,
    orderBy: "startTime",
    maxResults: input.range === "next" ? 1 : 20,
    timeZone,
    ...bounds,
  });
  return formatCalendarEventsSpeech({
    range: input.range,
    timeZone,
    events: response.data.items ?? [],
  });
}
