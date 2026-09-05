'use client';

import dynamic from 'next/dynamic';
import type { Diagram } from '@/content/schema';

type FlowSpec = Extract<Diagram, { kind: 'flow' }>;

/**
 * React Flow is ~90 kB and needs the DOM. Loading it lazily keeps it out of the
 * lesson page's initial payload — most sections of a lesson are read before the
 * diagram is ever scrolled to.
 */
const FlowDiagram = dynamic(() => import('./FlowDiagram').then((m) => m.FlowDiagram), {
  ssr: false,
  loading: () => (
    <div className="plan-grid my-7 h-[22rem] animate-pulse rounded-[3px] border border-[var(--rule)]" />
  ),
});

export function FlowDiagramLazy({ spec }: { spec: FlowSpec }) {
  return <FlowDiagram spec={spec} />;
}
