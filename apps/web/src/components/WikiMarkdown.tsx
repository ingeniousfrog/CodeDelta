import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import type { Schema } from 'hast-util-sanitize';

/** Allow common README HTML (headings, images, links) while stripping scripts/handlers. */
const wikiSanitizeSchema: Schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    h1: [...(defaultSchema.attributes?.h1 ?? []), 'align'],
    h2: [...(defaultSchema.attributes?.h2 ?? []), 'align'],
    p: [...(defaultSchema.attributes?.p ?? []), 'align'],
    img: [...(defaultSchema.attributes?.img ?? []), 'src', 'alt', 'width', 'height', 'title', 'align'],
    a: [...(defaultSchema.attributes?.a ?? []), 'href', 'title', 'target', 'rel'],
  },
};

let mermaidRenderCounter = 0;

function MermaidBlock({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'neutral' });
        const id = `wiki-mermaid-${mermaidRenderCounter++}`;
        const { svg: rendered } = await mermaid.render(id, code);
        if (!cancelled) setSvg(rendered);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [code]);

  if (failed) return <pre className="wiki-code">{code}</pre>;
  if (!svg) return <p className="hint">Rendering diagram…</p>;
  return <div className="wiki-mermaid" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export default function WikiMarkdown({ markdown }: { markdown: string }) {
  return (
    <div className="wiki-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, wikiSanitizeSchema]]}
        components={{
          code({ className, children, ...props }) {
            const text = String(children ?? '');
            if (className === 'language-mermaid') {
              return <MermaidBlock code={text.replace(/\n$/, '')} />;
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          },
        }}
      >
        {markdown}
      </ReactMarkdown>
    </div>
  );
}
