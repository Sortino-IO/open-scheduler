export type DayEditorRect = { top: number; bottom: number; height: number };

export type DayEditorScrollPlan = {
  action: "none" | "scroll";
  scrollMarginTop: number;
  behavior: "auto" | "smooth";
};

/**
 * The editor is usable when its top sits under the sticky header / safe area
 * and enough of the block controls are on screen. A card below the fold is not.
 */
export function isDayEditorInUsableView(rect: DayEditorRect, viewportHeight: number, topInset: number): boolean {
  if (viewportHeight <= 0 || rect.height <= 0) return false;
  const visibleTop = Math.max(rect.top, topInset);
  const visibleBottom = Math.min(rect.bottom, viewportHeight);
  const visible = visibleBottom - visibleTop;
  const minVisible = Math.min(180, Math.max(96, rect.height * 0.2));
  return rect.top >= topInset - 1 && rect.top <= viewportHeight - minVisible && visible >= minVisible;
}

export function planDayEditorScroll(input: {
  rect: DayEditorRect;
  viewportHeight: number;
  stickyHeaderHeight: number;
  stickyHeaderVisible: boolean;
  safeAreaTop: number;
  reduceMotion: boolean;
}): DayEditorScrollPlan {
  const headerInset = input.stickyHeaderVisible ? Math.max(0, input.stickyHeaderHeight) : 0;
  const scrollMarginTop = Math.max(headerInset, Math.max(0, input.safeAreaTop)) + 12;
  const usable = isDayEditorInUsableView(input.rect, input.viewportHeight, scrollMarginTop);
  return {
    action: usable ? "none" : "scroll",
    scrollMarginTop,
    behavior: input.reduceMotion ? "auto" : "smooth",
  };
}

function safeAreaTop(doc: Document): number {
  const probe = doc.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.paddingTop = "env(safe-area-inset-top)";
  doc.body.appendChild(probe);
  const value = Number.parseFloat(doc.defaultView?.getComputedStyle(probe).paddingTop || "0") || 0;
  probe.remove();
  return value;
}

/** Scroll the selected-day editor under the sticky admin header. No-op when it is already usable. */
export function revealDayEditor(node: HTMLElement): void {
  const view = node.ownerDocument.defaultView;
  if (!view) return;
  const header = node.ownerDocument.querySelector<HTMLElement>("[data-admin-sticky-header]");
  let stickyHeaderHeight = 0;
  let stickyHeaderVisible = false;
  if (header) {
    const style = view.getComputedStyle(header);
    stickyHeaderVisible = style.display !== "none" && style.visibility !== "hidden" && (style.position === "sticky" || style.position === "fixed");
    if (stickyHeaderVisible) stickyHeaderHeight = Math.max(0, header.getBoundingClientRect().bottom);
  }
  const rect = node.getBoundingClientRect();
  const plan = planDayEditorScroll({
    rect: { top: rect.top, bottom: rect.bottom, height: rect.height },
    viewportHeight: view.innerHeight,
    stickyHeaderHeight,
    stickyHeaderVisible,
    safeAreaTop: safeAreaTop(node.ownerDocument),
    reduceMotion: view.matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
  node.style.scrollMarginTop = `${plan.scrollMarginTop}px`;
  if (plan.action === "none") return;
  node.scrollIntoView({ block: "start", inline: "nearest", behavior: plan.behavior });
}
