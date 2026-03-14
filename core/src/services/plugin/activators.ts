import type { Activator } from "./types";

export function requireSession(reason?: string): Activator {
  return {
    check: (ctx) => {
      const capability =
        ctx.capabilities?.core["platform.session"] ??
        ctx.capabilities?.extended["platform.session"];
      if (capability) {
        return capability.status === "available";
      }

      return !!ctx.session;
    },
    reason: reason ?? "Requires active session",
    onFail: "remove",
  };
}

export function requirePlatform(platform: string | string[], reason?: string): Activator {
  const platforms = Array.isArray(platform) ? platform : [platform];
  return {
    check: (ctx) => {
      const scenarioPlatform = ctx.scenario?.raw.environment.platform;
      if (scenarioPlatform) {
        return platforms.includes(scenarioPlatform);
      }

      return !!ctx.session?.platform && platforms.includes(ctx.session.platform);
    },
    reason: reason ?? `Requires platform: ${platforms.join(" or ")}`,
    onFail: "remove",
  };
}

/**
 * @deprecated Phase 59: Use declarative requiredCapabilities on tool definitions instead.
 * Each tool should declare specific capability keys (e.g., "member.moderate", "social.essence").
 * This activator is retained as defense-in-depth; Phase 60 will remove it.
 */
export function requireBotRole(role: "admin" | "owner" = "admin", reason?: string): Activator {
  return {
    check: (ctx) => {
      const botRole = ctx.view?.self?.role;
      if (role === "admin") return botRole === "admin" || botRole === "owner";
      return botRole === "owner";
    },
    reason: reason ?? `Requires bot to have ${role} role`,
    onFail: "remove",
  };
}
