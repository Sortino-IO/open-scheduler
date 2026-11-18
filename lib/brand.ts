/**
 * Public branding and site identity. Display strings are env-driven with
 * neutral placeholders. Never default to a previous operator's name, email,
 * domain, or calendar.
 *
 * Client components can read the NEXT_PUBLIC_ vars. Server code accepts the
 * same names without the prefix as a fallback.
 */
function readEnv(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

function firstWord(value: string): string {
  return value.split(/\s+/).find(Boolean) || value;
}

function initialsFrom(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return "S";
  return parts
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("");
}

/** Full display name shown on the public page, emails, and share text. */
export function ownerName(): string {
  return readEnv("NEXT_PUBLIC_SCHEDULER_OWNER_NAME", "SCHEDULER_OWNER_NAME") || "Host";
}

/** First name used in short phrases such as "Alex will call…". */
export function ownerFirstName(): string {
  return (
    readEnv("NEXT_PUBLIC_SCHEDULER_OWNER_FIRST_NAME", "SCHEDULER_OWNER_FIRST_NAME") ||
    firstWord(ownerName())
  );
}

/** Optional organization or practice name. Empty if unset. */
export function organizationName(): string {
  return readEnv("NEXT_PUBLIC_SCHEDULER_ORGANIZATION", "SCHEDULER_ORGANIZATION");
}

export function siteName(): string {
  return readEnv("NEXT_PUBLIC_SCHEDULER_SITE_NAME", "SCHEDULER_SITE_NAME") || `${ownerName()} · Schedule`;
}

export function siteShortName(): string {
  return readEnv("NEXT_PUBLIC_SCHEDULER_SHORT_NAME", "SCHEDULER_SHORT_NAME") || "Schedule";
}

export function ownerInitials(): string {
  return readEnv("NEXT_PUBLIC_SCHEDULER_INITIALS", "SCHEDULER_INITIALS") || initialsFrom(ownerName());
}

export function avatarPath(): string {
  return readEnv("NEXT_PUBLIC_SCHEDULER_AVATAR", "SCHEDULER_AVATAR") || "/avatar.webp";
}

/** Optional logo in /public. When empty, the logo is omitted. */
export function logoPath(): string {
  return readEnv("NEXT_PUBLIC_SCHEDULER_LOGO", "SCHEDULER_LOGO");
}

export function logoAlt(): string {
  return organizationName() || siteName();
}

/** Privacy-policy contact. Falls back to the internal notice address when set. */
export function privacyEmail(): string {
  return readEnv("SCHEDULER_PRIVACY_EMAIL", "NOTIFY_EMAIL");
}

export function emailFooter(): string {
  const org = organizationName();
  return org ? `${ownerName()} · ${org}` : ownerName();
}

export function withOwner(label: string): string {
  return `${label} with ${ownerName()}`;
}

/**
 * Canonical public origin for metadata and share links.
 * Uses APP_ORIGIN, then the Vercel production or deployment URL, then localhost.
 * Never falls back to a hard-coded third-party domain.
 */
export function siteOrigin(): string {
  const configured = readEnv("APP_ORIGIN", "NEXT_PUBLIC_APP_ORIGIN").replace(/\/$/, "");
  if (configured) return configured.replace(/\/$/, "");
  const vercelProd = readEnv("VERCEL_PROJECT_PRODUCTION_URL").replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (vercelProd) return `https://${vercelProd}`;
  const vercel = readEnv("VERCEL_URL").replace(/^https?:\/\//, "").replace(/\/$/, "");
  if (vercel) return `https://${vercel}`;
  return "http://127.0.0.1:43123";
}

export function siteHost(): string {
  try {
    return new URL(siteOrigin()).host;
  } catch {
    return siteOrigin().replace(/^https?:\/\//, "");
  }
}
