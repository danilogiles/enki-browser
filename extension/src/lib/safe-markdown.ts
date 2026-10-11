/** Markdown for untrusted model output: no raw HTML, safe links, no images loading on their own. */
import { createElement, type ReactNode } from "react";
import type { Components } from "react-markdown";
import { safeHref } from "./search";

export const safeMarkdownComponents: Components = {
  a: ({ href, children }) => {
    const url = safeHref(href);
    return url
      ? createElement("a", { href: url, target: "_blank", rel: "noopener noreferrer" }, children)
      : createElement("span", null, children);
  },
  // An image would be fetched as soon as it renders, which can track the reader: show a link instead.
  img: ({ src, alt }) => {
    const url = safeHref(typeof src === "string" ? src : undefined);
    const label: ReactNode = `Image: ${alt || url || "unavailable"}`;
    return url
      ? createElement("a", { href: url, target: "_blank", rel: "noopener noreferrer", className: "img-link" }, label)
      : createElement("span", null, label);
  },
};

/** Props for <Markdown>: raw HTML in the source is dropped, not rendered. */
export const safeMarkdownProps = { skipHtml: true, components: safeMarkdownComponents } as const;
