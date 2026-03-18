import { Context, Service } from "koishi";

import type { SkillState } from "../../runtime/contracts";
import type { LoadAttempt, LoadResult, SkillDefinition } from "./types";

declare module "koishi" {
  interface Context {
    "yesimbot.session": AgentSessionStore;
  }
}

export interface AgentSessionState {
  loadedSkills: string[];
  loadHistory: LoadAttempt[];
}

function createEmptyState(): AgentSessionState {
  return {
    loadedSkills: [],
    loadHistory: [],
  };
}

export function projectSkillState(state: AgentSessionState): SkillState {
  return {
    active: [...state.loadedSkills],
    loadHistory: [...state.loadHistory],
    persistentRoster: [...state.loadedSkills],
  };
}

export class AgentSessionStore extends Service {
  private sessions = new Map<string, AgentSessionState>();

  constructor(ctx: Context) {
    super(ctx, "yesimbot.session", true);
    this.logger = ctx.logger("yesimbot.session");
  }

  private getKey(platform: string, channelId: string): string {
    return `${platform}:${channelId}`;
  }

  getState(platform: string, channelId: string): AgentSessionState {
    const key = this.getKey(platform, channelId);
    const existing = this.sessions.get(key);
    if (existing) {
      return existing;
    }

    const created = createEmptyState();
    this.sessions.set(key, created);
    return created;
  }

  loadSkill(
    platform: string,
    channelId: string,
    skill: SkillDefinition,
    caller?: string,
  ): LoadResult {
    const state = this.getState(platform, channelId);
    if (state.loadedSkills.includes(skill.name)) {
      state.loadHistory.push({
        name: skill.name,
        status: "already_loaded",
        timestamp: Date.now(),
        caller,
      });
      return { status: "already_loaded", skill };
    }

    state.loadedSkills.push(skill.name);
    state.loadHistory.push({
      name: skill.name,
      status: "loaded",
      timestamp: Date.now(),
      caller,
    });
    return { status: "loaded", skill };
  }

  unloadSkill(platform: string, channelId: string, skillName: string, caller?: string): boolean {
    const state = this.getState(platform, channelId);
    const index = state.loadedSkills.indexOf(skillName);
    if (index === -1) {
      return false;
    }

    state.loadedSkills.splice(index, 1);
    state.loadHistory.push({
      name: skillName,
      status: "unloaded",
      timestamp: Date.now(),
      caller,
    });
    return true;
  }

  reset(platform: string, channelId: string): void {
    this.sessions.delete(this.getKey(platform, channelId));
  }
}
