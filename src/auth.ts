import { createHash, timingSafeEqual } from "node:crypto";
import { verifyToken } from "@clerk/backend";
import { TokenVerificationError } from "@clerk/backend/errors";
import { createMiddleware } from "hono/factory";
import type { z } from "zod";
import type { ErrorResponse } from "./schemas";

/** A caller that isn't a User: the Coach or the MCP server. */
export type ServerCallerName = "coach" | "mcp";

/** Who a request comes from: a User (by Clerk User id) or a server caller. */
export type Caller =
  | { type: "user"; userId: string }
  | { name: ServerCallerName; type: "server" };

export interface AuthConfig {
  /** Each Clerk instance's PEM public key: a token verified by either is a User's. */
  clerkJwtKeys: { development?: string; production?: string };
  /** Each server caller's secret; unset or under 32 characters, it accepts nothing. */
  serverSecrets: Partial<Record<ServerCallerName, string>>;
}

export interface AuthEnv {
  Variables: { caller: Caller };
}

/** The OpenAPI security scheme every content route declares. */
export const BEARER_AUTH = "bearerAuth";

const BEARER = /^Bearer (\S+)$/i;

// Anything shorter isn't a generated secret (`openssl rand -hex 32` is 64).
const MIN_SECRET_LENGTH = 32;

const sha256 = (value: string) => createHash("sha256").update(value).digest();

const unauthorized = {
  error: {
    code: "unauthorized",
    message: "A Clerk session token or a server secret is required",
  },
} satisfies z.infer<typeof ErrorResponse>;

/** The User id (`sub`) of a Clerk session token verified by `jwtKey`, or why it was rejected. */
const verifyClerkToken = async (token: string, jwtKey: string) => {
  try {
    // Networkless: checks the signature, `exp`, `nbf` and `iat`, and requires a `sub`.
    const { sid, sub } = await verifyToken(token, { jwtKey });
    // Only a session token carries its session (`sid`): a JWT template's
    // token doesn't, and stays valid after the session ends.
    if (typeof sid !== "string") {
      return "no-session";
    }
    return { userId: sub };
  } catch (error) {
    if (error instanceof TokenVerificationError) {
      return error.reason;
    }
    throw error;
  }
};

/**
 * Requires `Authorization: Bearer <token>`: first a server secret (compared in
 * constant time), otherwise a Clerk session token from either Clerk instance.
 * Sets the resolved `caller` for later middleware; anything missing, malformed
 * or unverifiable answers 401.
 */
export const requireCaller = ({ clerkJwtKeys, serverSecrets }: AuthConfig) => {
  const jwtKeys = [clerkJwtKeys.production, clerkJwtKeys.development].filter(
    (key): key is string => Boolean(key)
  );
  const secrets = (["coach", "mcp"] as const).flatMap((name) => {
    const secret = serverSecrets[name];
    return secret && secret.length >= MIN_SECRET_LENGTH
      ? [{ hash: sha256(secret), name }]
      : [];
  });

  return createMiddleware<AuthEnv>(async (c, next) => {
    const token = c.req.header("authorization")?.match(BEARER)?.[1];
    if (token) {
      // Compared as digests: equal length, constant time.
      const tokenHash = sha256(token);
      const server = secrets.find(({ hash }) =>
        timingSafeEqual(tokenHash, hash)
      );
      if (server) {
        c.set("caller", { name: server.name, type: "server" });
        return next();
      }
      const results = await Promise.all(
        jwtKeys.map((jwtKey) => verifyClerkToken(token, jwtKey))
      );
      const verified = results.find((result) => typeof result !== "string");
      if (verified) {
        c.set("caller", { type: "user", userId: verified.userId });
        return next();
      }
      // A wrong Clerk key fails every token the same way a forged one does,
      // so log why: a burst of these points at the keys.
      console.warn(
        `Rejected bearer token: ${results.join(", ") || "no Clerk key"}`
      );
    }
    return c.json(unauthorized, 401);
  });
};
