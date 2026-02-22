const KEYWORDS = ["画", "绘", "draw", "paint", "sketch", "generate image", "生成图", "图片"];

module.exports = function activate(signals) {
  for (const s of signals) {
    if (s.metadata?.triggerContent) {
      const text = String(s.metadata.triggerContent).toLowerCase();
      if (KEYWORDS.some((kw) => text.includes(kw))) return true;
    }
  }
  return false;
};
