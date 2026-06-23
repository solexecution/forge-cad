// One HTML-escaper for every module that builds markup as strings. It escapes
// the four characters that matter in both text content and double-quoted
// attributes, so the same function is safe in either context — no per-call-site
// variants to drift apart. `&` must be replaced first so the entities it adds
// aren't re-escaped.
export const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
