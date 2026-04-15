'use client';

import { useMemo } from 'react';
import katex from 'katex';
import { motion } from 'motion/react';
import type { ImmersiveContent } from '@/lib/types/stage';

interface ImmersiveRendererProps {
  readonly content: ImmersiveContent;
  readonly mode: 'autonomous' | 'playback';
  readonly sceneId: string;
}

export function ImmersiveRenderer({ content, mode: _mode, sceneId: _sceneId }: ImmersiveRendererProps) {
  const { sceneImageUrl, narrativeText, historicalContext, keyFormulas } = content;

  const renderedFormulas = useMemo(() => {
    if (!keyFormulas || keyFormulas.length === 0) return null;
    return keyFormulas.map((formula) => {
      try {
        return katex.renderToString(formula, {
          throwOnError: false,
          displayMode: true,
        });
      } catch {
        return null;
      }
    });
  }, [keyFormulas]);

  return (
    <div className="relative w-full h-full overflow-hidden">
      {/* Full-screen background image or gradient placeholder */}
      <motion.div
        className="absolute inset-0"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.8 }}
      >
        {sceneImageUrl ? (
          <img
            src={sceneImageUrl}
            alt="Scene background"
            className="w-full h-full object-cover"
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-800" />
        )}
      </motion.div>

      {/* Darkening overlay for readability */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

      {/* Historical context badge — top-left */}
      {historicalContext && (
        <motion.div
          className="absolute top-4 left-4 z-10"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
        >
          <span className="inline-block rounded-md bg-white/15 backdrop-blur-md px-3 py-1.5 text-xs font-medium text-white/90 border border-white/10">
            {historicalContext}
          </span>
        </motion.div>
      )}

      {/* Formula cards — right side */}
      {renderedFormulas && renderedFormulas.length > 0 && (
        <motion.div
          className="absolute top-4 right-4 z-10 flex flex-col gap-2 max-w-[280px]"
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, delay: 0.5 }}
        >
          {renderedFormulas.map((html, i) =>
            html ? (
              <div
                key={i}
                className="rounded-lg bg-black/40 backdrop-blur-md px-4 py-3 border border-white/10 text-white overflow-x-auto [&_.katex-display]:!m-0 [&_.katex]:text-white"
                dangerouslySetInnerHTML={{ __html: html }}
              />
            ) : (
              <div
                key={i}
                className="rounded-lg bg-black/40 backdrop-blur-md px-4 py-3 border border-white/10"
              >
                <code className="text-sm text-white/80">{keyFormulas![i]}</code>
              </div>
            ),
          )}
        </motion.div>
      )}

      {/* Bottom narrative area */}
      <motion.div
        className="absolute bottom-0 left-0 right-0 z-10"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2 }}
      >
        <div className="bg-black/60 backdrop-blur-sm px-6 py-5 sm:px-8 sm:py-6">
          <p className="text-white/95 text-sm sm:text-base leading-relaxed max-w-3xl">
            {narrativeText}
          </p>
        </div>
      </motion.div>
    </div>
  );
}
