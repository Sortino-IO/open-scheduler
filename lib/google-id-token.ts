import { createPublicKey, createVerify, type JsonWebKey } from "node:crypto";

type CertJwk = JsonWebKey & { kid?: string };

let cachedKeys: { at: number; keys: CertJwk[] } | null = null;

function decodeJson(part: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
}

async function googleCerts(refresh = false): Promise<CertJwk[]> {
  if (!refresh && cachedKeys && Date.now() - cachedKeys.at < 60 * 60 * 1000) return cachedKeys.keys;
  const response = await fetch("https://www.googleapis.com/oauth2/v3/certs");
  if (!response.ok) throw new Error("id_token jwks unavailable");
  const json = (await response.json()) as { keys?: CertJwk[] };
  const keys = json.keys || [];
  if (!keys.length) throw new Error("id_token jwks unavailable");
  cachedKeys = { at: Date.now(), keys };
  return keys;
}

function verifySignature(headerPart: string, payloadPart: string, signature: string, jwk: CertJwk): boolean {
  const key = createPublicKey({ key: jwk, format: "jwk" });
  const verifier = createVerify("RSA-SHA256");
  verifier.update(`${headerPart}.${payloadPart}`);
  verifier.end();
  return verifier.verify(key, signature, "base64url");
}

/**
 * Claims are checked before the signature so a wrong audience is reported as an
 * audience failure. `alg: none` and any non-RS256 header are rejected first.
 * A token that passes the claims is still rejected unless Google's JWKS verifies it.
 */
export async function verifyGoogleIdToken(
  token: string,
  clientId: string,
  expectedNonce?: string,
): Promise<Record<string, unknown>> {
  const [headerPart, payloadPart, signature] = token.split(".");
  if (!headerPart || !payloadPart || signature == null) throw new Error("invalid id_token");
  const header = decodeJson(headerPart);
  if (header.alg !== "RS256") throw new Error("id_token alg is not allowed");
  const claims = decodeJson(payloadPart);
  const audience = claims.aud;
  const audienceOk = audience === clientId || (Array.isArray(audience) && audience.includes(clientId));
  if (!audienceOk) throw new Error("id_token audience mismatch");
  const issuer = String(claims.iss || "");
  if (issuer !== "https://accounts.google.com" && issuer !== "accounts.google.com") {
    throw new Error("id_token issuer mismatch");
  }
  if (typeof claims.exp !== "number" || claims.exp * 1000 < Date.now()) throw new Error("id_token expired");
  if (expectedNonce && claims.nonce !== expectedNonce) throw new Error("id_token nonce mismatch");
  const kid = typeof header.kid === "string" ? header.kid : "";
  let keys = await googleCerts();
  // Google rotates keys; an unknown kid means our cached set is stale.
  if (kid && !keys.some((key) => key.kid === kid)) keys = await googleCerts(true);
  const candidates = kid ? keys.filter((key) => key.kid === kid) : keys;
  const signed = candidates.some((key) => {
    try {
      return verifySignature(headerPart, payloadPart, signature, key);
    } catch {
      return false;
    }
  });
  if (!signed) throw new Error("id_token signature invalid");
  return claims;
}
