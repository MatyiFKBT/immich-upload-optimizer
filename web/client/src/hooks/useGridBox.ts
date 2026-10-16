import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Tracks the month grid's own box. Its width decides how many thumbnails fit, and its distance from
 * the top of the document tells the window virtualizer where its list begins. Both are read from the
 * container rather than the viewport, so the CSS tracks and the row chunking keep agreeing with each
 * other, and the list still lands correctly when the header above it wraps to another line.
 */
export function useGridBox() {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    // The grid is only mounted once, so one observer covers every later resize of the container.
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const offset = element.getBoundingClientRect().top + window.scrollY;
    // An unchanged offset bails out of the update, so re-reading it after every commit stays cheap.
    setScrollMargin((previous) => (previous === offset ? previous : offset));
  });

  return { ref, width, scrollMargin };
}
