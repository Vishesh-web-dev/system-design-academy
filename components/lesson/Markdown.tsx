import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import { cn } from '@/lib/utils';
import { MermaidBlock } from '../viz/MermaidBlock';

/**
 * Renders lesson prose on the server. The only client cost is the Mermaid
 * renderer, and only for lessons whose prose actually contains a diagram.
 *
 * Fenced ```mermaid blocks are lifted out and handed to the client-only
 * renderer; everything else is static markup.
 */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn('prose-sheet', className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeHighlight, { detect: true, ignoreMissing: true }]]}
        components={{
          pre({ children }) {
            return <>{children}</>;
          },
          code({ className, children, ...props }) {
            const language = /language-(\w+)/.exec(className ?? '')?.[1];
            const text = String(children).replace(/\n$/, '');
            const isBlock = Boolean(language) || text.includes('\n');

            if (language === 'mermaid') {
              return <MermaidBlock code={text} />;
            }
            if (!isBlock) {
              return (
                <code className={className} {...props}>
                  {children}
                </code>
              );
            }
            return (
              <pre>
                <code className={className}>{children}</code>
              </pre>
            );
          },
          table({ children }) {
            return (
              <div className="-mx-1 overflow-x-auto px-1">
                <table>{children}</table>
              </div>
            );
          },
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
