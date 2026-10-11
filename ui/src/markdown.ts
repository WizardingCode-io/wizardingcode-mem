// Text that agents write in Markdown, rendered for the viewer. Raw HTML is off, so anything
// that looks like a tag is escaped; markdown-it refuses javascript:, vbscript: and data:
// links. Links open in a new tab, without the referrer. Images are never loaded (nothing
// leaves for the network from the viewer): an image shows as its alt text.
import MarkdownIt from "markdown-it";

const md = new MarkdownIt({ html: false, linkify: false, breaks: true, typographer: false });
const defaultLink = md.renderer.rules.link_open ?? ((tokens, idx, options, _env, self) => self.renderToken(tokens, idx, options));
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  tokens[idx]?.attrSet("target", "_blank");
  tokens[idx]?.attrSet("rel", "noopener noreferrer");
  return defaultLink(tokens, idx, options, env, self);
};

md.renderer.rules.image = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  return token?.children ? self.renderInline(token.children, options, env) : "";
};

export const renderMarkdown = (source: string): string => md.render(source);
