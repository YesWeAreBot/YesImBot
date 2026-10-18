import { h, type Session } from "koishi";
import { CQCode, OneBot } from "koishi-plugin-adapter-onebot";
import * as qface from "qface";

const record = (value: unknown): value is Record<string, any> => !!value && typeof value === "object" && !Array.isArray(value);
const scalar = (value: unknown) => (typeof value === "string" || (typeof value === "number" && Number.isFinite(value)) ? String(value) : undefined);

/** Only an actual face segment may produce this marker; never infer it from text. */
export function oneBotFaceElement(attrs: Record<string, any>) {
    const raw = record(attrs.raw) ? attrs.raw : {};
    const id = scalar(attrs.id);
    const label = [raw.faceText, attrs.faceText, attrs.name, attrs.text, id ? qface.get(id)?.QDes : undefined].find(
        (value) => typeof value === "string" && value.trim(),
    );
    const name = (typeof label === "string" ? label.trim().replace(/^\//, "").slice(0, 128) : "") || "未知QQ表情";
    const large = attrs.large === true || attrs.large === "true" || attrs.large === "1";
    const kind = large || String(attrs.subType ?? attrs.sub_type ?? raw.faceType) === "3" ? "super" : "system";
    return h("face", {
        platform: "onebot",
        id,
        name,
        kind,
        chainCount: scalar(attrs.chainCount ?? attrs.chain_count ?? raw.chainCount),
        resultId: scalar(attrs.resultId ?? attrs.result_id ?? raw.resultId),
    });
}

/** Native recovery requires a complete, positionally matching OneBot array. */
export function recoverNativeFaces(message: unknown, native: unknown) {
    if (!Array.isArray(message) || !Array.isArray(native) || message.length !== native.length) return;
    let changed = false;
    const recovered = message.map((segment) => structuredClone(segment));
    for (const [index, segment] of recovered.entries()) {
        const element = native[index];
        if (!record(segment) || !record(segment.data) || !record(element)) return;
        if (record(element.faceElement)) {
            const face = element.faceElement;
            const id = scalar(face.faceIndex);
            if (!id || !/^\d+$/.test(id)) return;
            if (segment.type === "face") {
                if (String(segment.data.id) !== id) return;
                if (!record(segment.data.raw)) {
                    recovered[index] = { ...segment, data: { ...segment.data, raw: face } };
                    changed = true;
                }
            } else if (segment.type === "text" && typeof face.faceText === "string" && face.faceText && segment.data.text === face.faceText) {
                recovered[index] = { type: "face", data: { id, raw: face } };
                changed = true;
            } else return;
        } else if (segment.type === "text" && (!record(element.textElement) || segment.data.text !== element.textElement.content)) return;
    }
    return changed ? recovered : undefined;
}

function faceMarkup(content: string, segments: h[] = []) {
    const faces = new Map<string, Array<Record<string, any>>>();
    for (const segment of segments) {
        if (segment.type !== "face") continue;
        const key = String(segment.attrs.id);
        const list = faces.get(key) ?? [];
        list.push(segment.attrs);
        faces.set(key, list);
    }
    return h
        .transform(h.parse(content), {
            face: (attrs) => oneBotFaceElement({ ...attrs, ...faces.get(String(attrs.id))?.shift() }),
        })
        .join("");
}

/** Normalize the model/history copy only, leaving other Koishi plugins' sessions intact. */
export async function normalizeOneBotMessageContent(session: Session, content = session.content ?? ""): Promise<string> {
    if (session.platform !== "onebot") return content;
    const payload: unknown = session.onebot ?? session.event?._data;
    if (!record(payload) || (!Array.isArray(payload.message) && typeof payload.message !== "string")) return faceMarkup(content);
    let segments: h[];
    try {
        segments = CQCode.parse(payload.message);
    } catch {
        return faceMarkup(content);
    }
    const body = session.content ?? "";
    const prefix = body && content.endsWith(body) ? content.slice(0, -body.length) : "";
    const recovered = record(payload.raw) ? recoverNativeFaces(payload.message, payload.raw.elements) : undefined;
    if (recovered && Array.isArray(payload.message) && body && content.endsWith(body) && session.bot) {
        // Reuse the installed decoder to verify the whole original body. Remove
        // only the detached leading reply to avoid getMessage/network side effects.
        const decode = async (message: any[]) => {
            const chain = message[0]?.type === "reply" ? message.slice(1) : message;
            return (
                (
                    await OneBot.adaptMessage(
                        session.bot as any,
                        { ...payload, message_id: payload.message_id ?? session.messageId ?? "face", message: chain } as any,
                        {},
                        null as any,
                    )
                ).content ?? ""
            );
        };
        try {
            if ((await decode(payload.message)) === body) {
                return faceMarkup(prefix) + faceMarkup(await decode(recovered), CQCode.parse(recovered));
            }
        } catch {
            /* An unverified fallback remains literal text. */
        }
    }
    // Detached quotes have their own provenance; do not enrich their faces with
    // metadata belonging to the current message's identical face IDs.
    return prefix ? faceMarkup(prefix) + faceMarkup(body, segments) : faceMarkup(content, segments);
}
