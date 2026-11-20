// ── XML → könnyű fa ──────────────────────────────────────────────────────────

export interface XmlNode {
  tag: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  text: string;
}

export function parseXml(src: string): XmlNode | null {
  const re =
    /<!--[\s\S]*?-->|<!\[CDATA\[([\s\S]*?)\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<([a-zA-Z][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|<\/([a-zA-Z][\w:.-]*)\s*>|([^<]+)/g;
  const root: XmlNode = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack: XmlNode[] = [root];
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    const [full, cdata, openTag, rawAttrs, selfClose, closeTag, textRun] = m;
    const top = stack[stack.length - 1];
    if (openTag) {
      const node: XmlNode = { tag: openTag, attrs: parseAttrs(rawAttrs ?? ''), children: [], text: '' };
      top.children.push(node);
      if (!selfClose) stack.push(node);
    } else if (closeTag) {
      // a megnyitott elemhez tekerünk vissza (rosszul zárt XML tolerálása)
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === closeTag) {
          stack.length = i;
          break;
        }
      }
    } else if (cdata !== undefined) {
      top.text += cdata;
    } else if (textRun !== undefined && !openTag && !closeTag) {
      const t = textRun.replace(/\s+/g, ' ');
      if (t.trim()) top.text += t;
    }
    void full;
  }
  return root.children.find((c) => c.tag === 'svg') ?? root.children[0] ?? null;
}

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    attrs[m[1]] = decodeEntities(m[2] ?? m[3] ?? '');
  }
  return attrs;
}

function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(parseInt(d, 10)))
    .replace(/&amp;/g, '&');
}
