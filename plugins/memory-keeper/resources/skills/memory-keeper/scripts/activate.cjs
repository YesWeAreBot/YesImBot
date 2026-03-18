const KEYWORDS = [];

module.exports = function activate(signals) {
  return true;
  // for (const s of signals) {
  //   if (s.metadata?.triggerContent) {
  //     const text = String(s.metadata.triggerContent).toLowerCase();
  //     if (KEYWORDS.some((kw) => text.includes(kw))) return true;
  //   }
  // }
  // return false;
};
