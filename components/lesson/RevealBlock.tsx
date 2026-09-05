'use client';

import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Eye } from 'lucide-react';
import { Button } from '../ui/primitives';

/**
 * The one orchestrated motion in this product: content that stays hidden until
 * the learner has committed to an answer.
 *
 * This is not a disclosure widget for tidiness. Reading an explanation you have
 * not first tried to produce yourself feels like learning and is not; hiding it
 * behind a deliberate action is the whole mechanism (docs/PRODUCT.md → Learning
 * philosophy).
 */
export function RevealBlock({
  children,
  label = 'Show the answer',
  hint,
  onReveal,
}: {
  children: React.ReactNode;
  label?: string;
  hint?: string;
  onReveal?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const reduced = useReducedMotion();

  return (
    <div className="my-4">
      {!open ? (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="secondary"
            onClick={() => {
              setOpen(true);
              onReveal?.();
            }}
          >
            <Eye size={14} strokeWidth={1.75} />
            {label}
          </Button>
          {hint ? <span className="text-xs text-[var(--text-faint)]">{hint}</span> : null}
        </div>
      ) : null}

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            initial={reduced ? { opacity: 0 } : { opacity: 0, height: 0, filter: 'blur(4px)' }}
            animate={reduced ? { opacity: 1 } : { opacity: 1, height: 'auto', filter: 'blur(0px)' }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, height: 0 }}
            transition={{ duration: reduced ? 0.01 : 0.34, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <div className="border-l-2 border-signal-600 pl-4">{children}</div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
