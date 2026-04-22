import { parse } from "node-html-parser";
import type { Patch } from "../../types.js";

// Handles patches of type meta_tag_edit.
// patch.target is one of:
//   "title"                     -> edits <title> element
//   "<name>"                    -> edits <meta name="<name>" content="...">
//   "<property>" (e.g og:title) -> edits <meta property="<property>" ...>
// patch.after is the new content string. If the tag doesn't exist it is
// inserted inside <head>.
export interface MetaEditResult {
  html: string;
  ok: boolean;
  reason?: string;
}

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildMetaTag(targetKey: string, content: string): string {
  const attrKey = targetKey.includes(":") ? "property" : "name";
  return `<meta ${attrKey}="${escapeAttr(targetKey)}" content="${escapeAttr(content)}">`;
}

export function applyMetaTagEdit(html: string, patch: Patch): MetaEditResult {
  if (!patch.after) {
    return { html, ok: false, reason: "meta_tag_edit: empty `after` content" };
  }
  const targetKey = patch.target.trim();
  if (!targetKey) {
    return { html, ok: false, reason: "meta_tag_edit: empty target" };
  }

  const root = parse(html);
  const head = root.querySelector("head");
  if (!head) {
    return { html, ok: false, reason: "meta_tag_edit: <head> not found" };
  }

  // Special-case <title>
  if (targetKey.toLowerCase() === "title") {
    let title = root.querySelector("title");
    if (title) {
      title.set_content(escapeAttr(patch.after));
    } else {
      head.insertAdjacentHTML("afterbegin", `<title>${escapeAttr(patch.after)}</title>`);
    }
    return { html: root.toString(), ok: true };
  }

  // Meta tag by name or property
  const selector = targetKey.includes(":")
    ? `meta[property="${targetKey}"]`
    : `meta[name="${targetKey}"]`;
  const existing = root.querySelector(selector);
  if (existing) {
    existing.setAttribute("content", patch.after);
  } else {
    head.insertAdjacentHTML("beforeend", "\n  " + buildMetaTag(targetKey, patch.after));
  }

  return { html: root.toString(), ok: true };
}
