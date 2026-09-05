'use client';

import { useEffect, useId, useRef, useState } from 'react';

/**
 * Client-only Mermaid renderer. Mermaid is imported dynamically on mount so it
 * never reaches the initial payload of a lesson that has no diagram, and never
 * runs during server rendering (it needs the DOM to measure text).
 */
export function MermaidBlock({ code }: { code: string }) {
  const id = useId().replace(/[:]/g, '');
  const ref = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      const mermaid = (await import('mermaid')).default;
      const light = document.documentElement.getAttribute('data-theme') === 'light';

      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        theme: 'base',
        fontFamily: 'var(--font-archivo), system-ui, sans-serif',
        themeVariables: light
          ? {
              background: '#ffffff',
              primaryColor: '#eef3f8',
              primaryTextColor: '#16202b',
              primaryBorderColor: '#b9c6d2',
              lineColor: '#5f7285',
              secondaryColor: '#e3f2ef',
              tertiaryColor: '#f7f9fb',
            }
          : {
              background: 'transparent',
              primaryColor: '#1b2531',
              primaryTextColor: '#e7edf3',
              primaryBorderColor: '#35897e',
              lineColor: '#6f8194',
              secondaryColor: '#17272a',
              tertiaryColor: '#151d26',
            },
      });

      try {
        const { svg } = await mermaid.render(`m-${id}`, code);
        if (!cancelled && ref.current) {
          ref.current.innerHTML = svg;
          setReady(true);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Diagram failed to render');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [code, id]);

  if (error) {
    // Never hide a broken diagram: the source is still the content.
    return (
      <figure className="my-6">
        <p className="mb-2 text-xs text-alert-400">Diagram could not be rendered. Source below.</p>
        <pre>
          <code>{code}</code>
        </pre>
      </figure>
    );
  }

  return (
    <div
      ref={ref}
      className="plan-grid my-6 overflow-x-auto rounded-[3px] border border-[var(--rule)] p-4"
      style={{ minHeight: ready ? undefined : '8rem' }}
      aria-label="Diagram"
    />
  );
}
