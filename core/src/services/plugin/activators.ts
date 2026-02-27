import type { Activator } from "./types";

export function requireSession(reason?: string): Activator {
  return {
    check: (ctx) => !!ctx.session,
    reason: reason ?? "Requires active session",
    onFail: "remove",
  };
}

export function requirePlatform(platform: string | string[], reason?: string): Activator {
  const platforms = Array.isArray(platform) ? platform : [platform];
  return {
    check: (ctx) => !!ctx.session?.platform && platforms.includes(ctx.session.platform),
    reason: reason ?? `Requires platform: ${platforms.join(" or ")}`,
    onFail: "remove",
  };
}

export function requireBotRole(role: "admin" | "owner" = "admin", reason?: string): Activator {
  return {
    check: (ctx) => {
      const botRole = ctx["botRole"] as string | undefined;
      if (role === "admin") return botRole === "admin" || botRole === "owner";
      return botRole === "owner";
    },
    reason: reason ?? `Requires bot to have ${role} role`,
    onFail: "remove",
  };
}
