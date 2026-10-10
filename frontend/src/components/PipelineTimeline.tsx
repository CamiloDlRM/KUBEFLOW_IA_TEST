"use client";

import { useRef, type ReactNode } from "react";
import {
  motion,
  useReducedMotion,
  useScroll,
  useTransform,
  type UseScrollOptions,
} from "motion/react";
// Si usas framer-motion en vez de motion, cambia el import a: "framer-motion"

export interface PipelineStep {
  title: string;
  description: string;
  /** Espacio para el icono: cualquier ReactNode (ej. <Database />). Si no lo pasas, se muestra el número del paso. */
  icon?: ReactNode;
}

interface PipelineTimelineProps {
  steps: PipelineStep[];
  /**
   * Punto de la pantalla (0 a 1, desde arriba) donde "llega" la línea.
   * 0.6 = la línea avanza cuando el contenido cruza el 60% de la altura.
   * Si la sección queda muy pegada al final de la página, súbelo (0.7 u 0.75)
   * para que el último paso alcance a activarse.
   */
  triggerPoint?: number;
  className?: string;
}

const range = (from: string, to: string) =>
  [from, to] as UseScrollOptions["offset"];

/** Segmento de línea entre un nodo y el siguiente. Se llena al bajar y se vacía al subir. */
function Segment({ triggerPoint }: { triggerPoint: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: range(`start ${triggerPoint}`, `end ${triggerPoint}`),
  });

  return (
    <div
      ref={ref}
      aria-hidden
      className="absolute -bottom-5 left-1/2 top-5 w-0.5 -translate-x-1/2 bg-white/15"
    >
      <motion.div
        style={{ scaleY: scrollYProgress }}
        className="h-full w-full origin-top bg-white shadow-[0_0_12px_rgba(255,255,255,0.55)]"
      />
    </div>
  );
}

function TimelineItem({
  step,
  index,
  isLast,
  triggerPoint,
}: {
  step: PipelineStep;
  index: number;
  isLast: boolean;
  triggerPoint: number;
}) {
  const reduceMotion = useReducedMotion();
  const onLeft = index % 2 === 0; // alterna: izquierda, derecha, izquierda...

  // Punto invisible en el centro del nodo: marca cuándo la línea lo alcanza
  const sentinelRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress: reached } = useScroll({
    target: sentinelRef,
    offset: range(`start ${triggerPoint}`, `start ${triggerPoint - 0.03}`),
  });

  const fill = useTransform(reached, [0, 1], [0, 1]);
  const iconColor = useTransform(
    reached,
    [0, 1],
    ["rgba(255,255,255,0.55)", "#020617"]
  );
  const glow = useTransform(reached, [0, 1], [
    "0 0 0px 0px rgba(129,140,248,0)",
    "0 0 24px 4px rgba(129,140,248,0.45)",
  ]);
  const cardOpacity = useTransform(reached, [0, 1], [0, 1]);
  const cardX = useTransform(reached, [0, 1], [onLeft ? -28 : 28, 0]);

  return (
    <li
      className={`relative grid grid-cols-[2.5rem_1fr] gap-x-5 md:grid-cols-[1fr_2.5rem_1fr] md:gap-x-10 ${
        isLast ? "" : "pb-10 md:pb-16"
      }`}
    >
      {/* Columna central: nodo + línea */}
      <div className="relative col-start-1 row-start-1 flex justify-center md:col-start-2">
        {!isLast && <Segment triggerPoint={triggerPoint} />}

        <div ref={sentinelRef} aria-hidden className="absolute left-1/2 top-5 h-px w-px" />

        <motion.div
          style={{ boxShadow: glow }}
          className="relative z-10 grid h-10 w-10 place-items-center rounded-full "
        >
          <motion.span
            aria-hidden
            style={{ scale: fill }}
            className="absolute inset-0 rounded-full bg-white"
          />
          <motion.span
            style={{ color: iconColor }}
            className="relative flex items-center justify-center text-sm font-semibold [&>svg]:h-5 [&>svg]:w-5"
          >
            {step.icon ?? index + 1}
          </motion.span>
        </motion.div>
      </div>

      {/* Tarjeta: alterna de lado en pantallas md+ */}
      <motion.div
        style={reduceMotion ? undefined : { opacity: cardOpacity, x: cardX }}
        className={`col-start-2 row-start-1 ${
          onLeft ? "md:col-start-1" : "md:col-start-3"
        }`}
      >
        <article className="rounded-2xl border border-white/10 bg-slate-900/60 p-5 backdrop-blur-sm">
          <h3 className="text-lg font-semibold tracking-tight text-slate-100">
            {step.title}
          </h3>
          <p className="mt-2 text-sm leading-relaxed text-slate-400">
            {step.description}
          </p>
        </article>
      </motion.div>
    </li>
  );
}

export function PipelineTimeline({
  steps,
  triggerPoint = 0.5,
  className = "",
}: PipelineTimelineProps) {
  return (
    <ol className={`mx-auto w-full max-w-5xl ${className}`}>
      {steps.map((step, i) => (
        <TimelineItem
          key={`${step.title}-${i}`}
          step={step}
          index={i}
          isLast={i === steps.length - 1}
          triggerPoint={triggerPoint}
        />
      ))}
    </ol>
  );
}

export default PipelineTimeline;
