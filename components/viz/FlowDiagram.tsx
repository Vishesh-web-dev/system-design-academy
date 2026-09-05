'use client';

import { useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '../ui/primitives';
import type { Diagram } from '@/content/schema';
import { cn } from '@/lib/utils';

/**
 * The architecture walkthrough. React Flow is used only where the learner
 * manipulates the diagram — here, stepping through a critical flow and
 * selecting components to read why each exists.
 *
 * A diagram that merely restates the prose is rejected at authoring time
 * (docs/CONTENT_STYLE.md), so everything rendered here is a mechanism.
 */

type FlowSpec = Extract<Diagram, { kind: 'flow' }>;

const KIND_STYLE: Record<string, string> = {
  client: 'border-paper-400 text-paper-100',
  edge: 'border-brass-500 text-brass-400',
  service: 'border-signal-600 text-signal-400',
  store: 'border-[#7cc2e8] text-[#7cc2e8]',
  cache: 'border-alert-600 text-alert-400',
  queue: 'border-[#c8a2f0] text-[#c8a2f0]',
  external: 'border-[var(--rule-strong)] text-[var(--text-dim)]',
  actor: 'border-paper-400 text-paper-100',
  note: 'border-dashed border-[var(--rule-strong)] text-[var(--text-dim)]',
};

type PlanNodeData = {
  label: string;
  kind: string;
  dimmed: boolean;
  active: boolean;
};

function PlanNode({ data }: NodeProps) {
  const d = data as PlanNodeData;
  return (
    <div
      className={cn(
        'min-w-[7.5rem] rounded-[3px] border bg-[var(--surface-raised)] px-3 py-2 text-center text-xs transition-opacity',
        KIND_STYLE[d.kind] ?? KIND_STYLE.service,
        d.dimmed && 'opacity-25',
        d.active && 'ring-1 ring-signal-500',
      )}
    >
      <Handle type="target" position={Position.Left} className="!h-1.5 !w-1.5 !border-0 !bg-[var(--rule-strong)]" />
      {d.label}
      <Handle type="source" position={Position.Right} className="!h-1.5 !w-1.5 !border-0 !bg-[var(--rule-strong)]" />
    </div>
  );
}

const nodeTypes = { plan: PlanNode };

export function FlowDiagram({ spec }: { spec: FlowSpec }) {
  const [step, setStep] = useState(-1); // -1 = whole diagram, no highlight
  const [selected, setSelected] = useState<string | null>(null);

  const active = step >= 0 ? spec.steps[step] : undefined;
  const activeNodes = useMemo(() => new Set(active?.nodes ?? []), [active]);
  const activeEdges = useMemo(() => new Set(active?.edges ?? []), [active]);

  const nodes: Node[] = spec.nodes.map((n) => ({
    id: n.id,
    type: 'plan',
    position: { x: n.x, y: n.y },
    data: {
      label: n.label,
      kind: n.kind,
      dimmed: Boolean(active) && !activeNodes.has(n.id),
      active: activeNodes.has(n.id),
    },
    draggable: false,
    connectable: false,
  }));

  const edges: Edge[] = spec.edges.map((e) => {
    const dimmed = Boolean(active) && !activeEdges.has(e.id);
    const highlighted = activeEdges.has(e.id);
    return {
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      animated: highlighted && e.kind === 'async',
      style: {
        stroke: highlighted ? 'var(--color-signal-500)' : 'var(--rule-strong)',
        strokeWidth: highlighted ? 1.75 : 1,
        strokeDasharray: e.kind === 'async' || e.kind === 'control' ? '4 3' : undefined,
        opacity: dimmed ? 0.2 : 1,
      },
      labelStyle: { fill: 'var(--text-dim)', fontSize: 11 },
      labelBgStyle: { fill: 'var(--ground)' },
    };
  });

  const detail = selected ? spec.nodes.find((n) => n.id === selected) : undefined;

  return (
    <figure className="my-7">
      <figcaption className="mb-2">
        <span className="text-sm font-semibold">{spec.title}</span>
        <p className="mt-1 max-w-[70ch] text-sm text-[var(--text-dim)]">{spec.caption}</p>
      </figcaption>

      <div className="plan-grid h-[22rem] rounded-[3px] border border-[var(--rule)]">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.18 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={false}
          nodesConnectable={false}
          onNodeClick={(_, node) => setSelected((s) => (s === node.id ? null : node.id))}
          minZoom={0.3}
          maxZoom={1.6}
        >
          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="transparent" />
        </ReactFlow>
      </div>

      {spec.steps.length > 0 ? (
        <div className="mt-3 rounded-[3px] border border-[var(--rule)] bg-[var(--surface)] p-4">
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-xs text-[var(--text-faint)]">
              {step < 0 ? `${spec.steps.length} steps` : `Step ${step + 1} of ${spec.steps.length}`}
            </span>
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setStep((s) => Math.max(-1, s - 1))}
                disabled={step < 0}
                aria-label="Previous step"
              >
                <ChevronLeft size={14} />
              </Button>
              <Button
                size="sm"
                variant={step < 0 ? 'primary' : 'secondary'}
                onClick={() => setStep((s) => Math.min(spec.steps.length - 1, s + 1))}
                disabled={step >= spec.steps.length - 1}
              >
                {step < 0 ? 'Walk the flow' : 'Next'}
                <ChevronRight size={14} />
              </Button>
            </div>
          </div>

          {active ? (
            <div className="mt-3">
              <p className="text-sm font-medium">{active.title}</p>
              <p className="mt-1 max-w-[70ch] text-sm text-[var(--text-dim)]">{active.description}</p>
            </div>
          ) : (
            <p className="mt-3 max-w-[70ch] text-sm text-[var(--text-dim)]">
              Step through the flow one hop at a time, or click any component to read why it is there.
            </p>
          )}
        </div>
      ) : null}

      {detail?.detail ? (
        <div className="mt-2 rounded-[3px] border border-signal-600/40 bg-[var(--surface)] p-3">
          <p className="text-xs font-semibold text-signal-400">{detail.label}</p>
          <p className="mt-1 max-w-[70ch] text-sm text-[var(--text-dim)]">{detail.detail}</p>
        </div>
      ) : null}
    </figure>
  );
}
