"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useCallback, useState } from "react";
import { TopBar } from "@/components/TopBar";
import { HeadlineStrip } from "@/components/HeadlineStrip";
import { VideoPanel } from "@/components/VideoPanel";
import { ChokeHeatmap } from "@/components/ChokeHeatmap";
import { DirectiveFeed } from "@/components/DirectiveFeed";
import { WhatIfDrawer } from "@/components/WhatIfDrawer";
import { MethodologyDrawer } from "@/components/MethodologyDrawer";
import type { Directive } from "@/lib/data";

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07 } },
};

const item = {
  hidden: { opacity: 0, y: 12 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] as const },
  },
};

export function AppShell() {
  const [t, setT] = useState(0);
  const [whatIfOpen, setWhatIfOpen] = useState(false);
  const [seed, setSeed] = useState<Directive | null>(null);

  const openWhatIf = useCallback((d: Directive | null) => {
    setSeed(d);
    setWhatIfOpen(true);
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <TopBar onOpenWhatIf={() => openWhatIf(null)} />

      <motion.main
        variants={container}
        initial="hidden"
        animate="show"
        className="mx-auto flex w-full max-w-[1600px] flex-1 flex-col px-6 pt-8"
      >
        <motion.section variants={item}>
          <HeadlineStrip t={t} />
        </motion.section>

        <div className="mt-6 grid flex-1 grid-cols-1 gap-6 pb-16 xl:grid-cols-[minmax(0,2fr)_minmax(380px,1fr)]">
          <motion.div variants={item} className="flex min-w-0 flex-col gap-6">
            <VideoPanel t={t} onTime={setT} />
            <ChokeHeatmap t={t} />
          </motion.div>

          <motion.section
            variants={item}
            className="min-w-0 border border-line bg-panel"
          >
            <DirectiveFeed t={t} onSimulate={openWhatIf} />
          </motion.section>
        </div>
      </motion.main>

      <MethodologyDrawer />

      <AnimatePresence>
        {whatIfOpen && (
          <WhatIfDrawer
            directive={seed}
            onClose={() => setWhatIfOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
