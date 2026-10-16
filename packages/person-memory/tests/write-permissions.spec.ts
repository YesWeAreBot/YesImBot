import { expect, it } from "vitest";

import { applySharedMemory } from "../src/shared-runtime";
import { PersonStore, accountRef, mindScope } from "../src/store";
import { fixture } from "./helpers";

for (const action of ["propose", "propose_link"])
    for (const revoke of ["current", "source", "none", "session", "scope"])
        it(`${action} revalidates ${revoke} at the final commit boundary`, async (t) => {
            const tools = new Map<string, any>();
            let parent: any,
                disposed = false;
            const app = await fixture(t, (ctx) => {
                Object.defineProperty(ctx, "bots", {
                    value: [
                        {
                            platform: "onebot",
                            selfId: "bot",
                            session: (event: any) => ({ ...event, channelId: event.channel.id, isDirect: event.channel.type === 1, userId: event.userId }),
                        },
                    ],
                });
                ctx.set("yesimbot", {
                    world: { isChannelAllowed: () => true },
                    tool: {
                        registerTool: (tool: any) => {
                            tools.set(tool.name, tool);
                            return () => tools.delete(tool.name);
                        },
                        unregisterTool() {},
                    },
                    prompt: { inject: () => () => {} },
                });
                parent = ctx.extend();
                parent.filter = () => true;
                parent.plugin({
                    inject: ["database", "yesimbot"],
                    apply: (ctx: any) => {
                        ctx.on("dispose", () => {
                            disposed = true;
                        });
                        applySharedMemory(ctx, {
                            mode: "auto",
                            modelGroup: "",
                            summaryThreshold: 6,
                            cooldownSeconds: 600,
                            timeoutSeconds: 30,
                            maxQueue: 32,
                            recallScope: "mind",
                        } as any);
                    },
                });
            });
            const session = { platform: "onebot", selfId: "bot", channelId: "current", userId: "u", isDirect: false };
            await app.parallel("yesimbot/before-user-stimulus" as any, {
                ...session,
                channelId: "source",
                messageId: "m",
                content: "original fact",
                timestamp: Date.now(),
                author: { name: "User" },
            });
            const scope = mindScope(session),
                store = new PersonStore(app.database, "auto"),
                ref = accountRef("onebot", "u");
            const target = await store.create(scope, "Target", "admin");
            const found = (await store.find(scope, ref))!;
            const source = (await store.sources(scope, ref))[0];
            const before = (await store.history(scope)).length;
            const get = app.database.get.bind(app.database);
            let sourcesRead = 0,
                revoked = false;
            app.database.get = async (...args: any[]) => {
                const rows = await (get as any)(...args);
                if (args[0] === "person_memory.sources") sourcesRead++;
                // The first read validates caller provenance; the second is the
                // store's source validation inside its edit. Revoke after that
                // awaited read, before the store's final active check and INSERT.
                if (!revoked && sourcesRead >= 2 && args[0] === "person_memory.sources") {
                    revoked = true;
                    if (revoke === "session") session.channelId = "replacement";
                    else if (revoke === "scope") session.selfId = "replacement";
                    else if (revoke !== "none") parent.filter = (s: any) => s.channelId !== revoke;
                }
                return rows;
            };
            const result = await tools.get("person_memory").execute({
                session,
                action,
                account_id: "u",
                profile: "new fact",
                message_ids: [source.id],
                person_id: found.person.id,
                person_revision: found.person.revision,
                account_revision: found.accounts[0].revision,
                target_person_id: target.id,
                target_revision: target.revision,
                confidence: 1,
                reason: "explicit claim",
            });
            expect(revoked).toBe(true);
            expect(disposed).toBe(false);
            expect(result.status).toBe(revoke === "none" ? "success" : "error");
            expect((await store.history(scope)).length).toBe(before + (revoke === "none" ? 1 : 0));
            const after = (await store.find(scope, ref))!;
            expect(after.person.id).toBe(action === "propose_link" && revoke === "none" ? target.id : found.person.id);
            expect(after.person.profile).toBe(action === "propose" && revoke === "none" ? "new fact" : "");
        });

for (const boundary of ["mode", "identity", "source", "continuity"] as const)
    for (const revoke of ["permission", "session", "scope", "none"] as const)
        it(`ingress revalidates ${revoke} at the ${boundary} write boundary`, async (t) => {
            let allowed = true;
            const app = await fixture(t, (ctx) => {
                ctx.set("yesimbot", {
                    world: { isChannelAllowed: () => allowed },
                    tool: { registerTool: () => () => {}, unregisterTool() {} },
                    prompt: { inject: () => () => {} },
                });
                ctx.plugin({
                    inject: ["database", "yesimbot"],
                    apply: (ctx: any) =>
                        applySharedMemory(ctx, {
                            mode: "auto",
                            modelGroup: "",
                            summaryThreshold: 6,
                            cooldownSeconds: 600,
                            timeoutSeconds: 30,
                            maxQueue: 32,
                            recallScope: "mind",
                        } as any),
                });
            });
            const session = {
                platform: "onebot",
                selfId: "bot",
                channelId: "current",
                userId: "u",
                isDirect: false,
                messageId: "m",
                content: "original source",
                timestamp: Date.now(),
                author: { name: "User" },
            };
            const scope = mindScope(session),
                ref = accountRef("onebot", "u");
            const get = app.database.get.bind(app.database);
            let revoked = false,
                stateReads = 0;
            app.database.get = async (...args: any[]) => {
                const rows = await (get as any)(...args);
                const table = String(args[0]);
                if (table === "person_memory.state") stateReads++;
                const hit =
                    boundary === "mode"
                        ? table === "person_memory.state"
                        : boundary === "identity"
                          ? table === "person_memory.audit" && stateReads === 2
                          : boundary === "source"
                            ? table === "person_memory.sources"
                            : table === "person_memory.experiences";
                if (!revoked && hit) {
                    revoked = true;
                    if (revoke === "permission") allowed = false;
                    else if (revoke === "session") session.channelId = "replacement";
                    else if (revoke === "scope") session.selfId = "replacement";
                }
                return rows;
            };
            await app.parallel("yesimbot/before-user-stimulus" as any, session);
            expect(revoked).toBe(true);
            const sources = await new PersonStore(app.database, "auto").sources(scope, ref);
            // Earlier accepted writes may remain; nothing is accepted beyond revocation.
            expect(sources).toHaveLength(revoke === "none" || boundary === "continuity" ? 1 : 0);
            const experiences = await app.database.get("person_memory.experiences" as any, {});
            expect(experiences).toHaveLength(revoke === "none" ? 1 : 0);
        });
