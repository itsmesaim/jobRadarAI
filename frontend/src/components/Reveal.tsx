import { useEffect, useRef } from "react";
import type { ReactNode } from "react";

function useScrollReveal<T extends HTMLElement>(delay: number) {
  const ref = useRef<T>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.transitionDelay = `${delay}ms`;

    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-visible");
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          el.classList.add("is-visible");
          observer.unobserve(el);
        }
      },
      { threshold: 0.15, rootMargin: "0px 0px -40px 0px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [delay]);

  return ref;
}

/** Fades + slides an element in once it scrolls into view. Stacks a `delay`
 * (ms) per sibling for a staggered reveal. No-ops instantly if the browser
 * lacks IntersectionObserver, and CSS disables the motion entirely under
 * prefers-reduced-motion (see .reveal in index.css). */
export function Reveal({
  children,
  className = "",
  delay = 0,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useScrollReveal<HTMLDivElement>(delay);
  return (
    <div ref={ref} className={`reveal ${className}`}>
      {children}
    </div>
  );
}
