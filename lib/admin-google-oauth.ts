import { randomBytes } from "node:crypto";
import { verifyGoogleIdToken } from "./google-id-token";
import { appOrigin } from "./origin";

export const ADMIN_OAUTH_STATE_COOKIE = "admin_google_oauth_state";
export const ADMIN_OAUTH_NONCE_COOKIE = "admin_google_oauth_nonce";

/** The owner address lives only in the host environment. Unset means nobody can sign in. */
export function adminOwnerEmail(): string {
  return process.env.ADMIN_GOOGLE_EMAIL?.trim().toLowerCase() || "";
}

/** Exact match on a verified address. An empty owner never matches. */
export function adminEmailAllowed(email: string, verified: boolean, owner = adminOwnerEmail()): boolean {
  const candidate = email.trim().toLowerCase();
  return verified && owner.length > 0 && candidate === owner;
}

/**
 * Default: reuse the redirect URI already registered on the Google OAuth client
 * (/api/oauth/google/callback). That route hands off to the admin handler only when the
 * admin state cookie matches; calendar connect is otherwise unchanged.
 * Once https://<host>/api/admin/oauth/google/callback is registered in Cloud Console,
 * set ADMIN_GOOGLE_REDIRECT_PATH=/api/admin/oauth/google/callback to use the dedicated route.
 */
export function adminGoogleRedirectUri(request: Request): string {
  const path = process.env.ADMIN_GOOGLE_REDIRECT_PATH || "/api/oauth/google/callback";
  return `${appOrigin(request)}${path}`;
}

export function readCookie(request: Request, name: string): string | undefined {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.split(/;\s*/).find((part) => part.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : undefined;
}

export function readAdminStateCookie(request: Request): string | undefined {
  return readCookie(request, ADMIN_OAUTH_STATE_COOKIE);
}

export function newOAuthNonce(): string {
  return randomBytes(24).toString("base64url");
}

/** No login_hint: the public sign-in link must not reveal the owner address. */
export function adminGoogleAuthUrl(request: Request, state: string, nonce: string): string {
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: adminGoogleRedirectUri(request),
    response_type: "code",
    scope: "openid email",
    prompt: "select_account",
    state,
    nonce,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/** Exchange the code with Google, then verify the id_token signature, claims, and nonce. */
export async function exchangeAdminGoogleCode(
  request: Request,
  code: string,
  expectedNonce: string,
): Promise<{ email: string; emailVerified: boolean }> {
  const clientId = process.env.GOOGLE_CLIENT_ID ?? "";
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: adminGoogleRedirectUri(request),
      grant_type: "authorization_code",
    }),
  });
  const json = (await response.json()) as { id_token?: string; error?: string; error_description?: string };
  if (!response.ok || !json.id_token) {
    throw new Error(json.error_description || json.error || `Token exchange failed (${response.status})`);
  }
  const claims = await verifyGoogleIdToken(json.id_token, clientId, expectedNonce);
  return {
    email: String(claims.email || "").toLowerCase(),
    emailVerified: claims.email_verified === true || claims.email_verified === "true",
  };
}
