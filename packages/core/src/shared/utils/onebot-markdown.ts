// Match the leading QQ mention in a platform Markdown segment.
export function readOneBotMarkdownMention(content: unknown) {
    if (typeof content !== "string") return null;
    return /^\[@[^\]\n]+\]\(mqqapi:\/\/markdown\/mention\?at_type=1&at_tinyid=(\d+)\)([\s\S]*)$/.exec(content);
}
