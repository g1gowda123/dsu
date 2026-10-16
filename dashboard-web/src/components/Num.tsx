"use client";

import { animate } from "framer-motion";
import { useEffect, useRef } from "react";

export function Num({
  value,
  format,
  className,
}: {
  value: number;
  format: (n: number) => string;
  className?: string;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(0);
  const fmt = useRef(format);

  useEffect(() => {
    fmt.current = format;
  }, [format]);

  useEffect(() => {
    const from = prev.current;
    const to = value;
    const controls = animate(from, to, {
      duration: 0.28,
      ease: "easeOut",
      onUpdate: (v) => {
        if (ref.current) ref.current.textContent = fmt.current(v);
      },
    });
    prev.current = to;
    return () => controls.stop();
  }, [value]);

  return (
    <span ref={ref} className={className}>
      {format(value)}
    </span>
  );
}
