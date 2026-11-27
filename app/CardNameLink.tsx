import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

type Position = {x: number; y: number};

export default function CardNameLink({ productId, children }: { productId: unknown; children: ReactNode }) {
  const anchor = useRef<HTMLAnchorElement>(null);
  const position = useRef<Position|null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const [tooltip, setTooltip] = useState<Position|null>(null);
  const tooltipId = useId();

  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
  }, []);

  const showAfterDelay = (next: Position) => {
    position.current = next;
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setTooltip(position.current);
      timer.current = null;
    }, 500);
  };
  const hide = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    position.current = null;
    setTooltip(null);
  };
  const id = String(productId ?? "");
  if (!/^\d+$/.test(id)) return <>{children}</>;
  return (
    <a
      ref={anchor}
      className="tcgplayer-name"
      href={"https://www.tcgplayer.com/product/" + id + "?Language=all&page=1"}
      target="_blank"
      rel="noopener noreferrer"
      aria-describedby={tooltip ? tooltipId : undefined}
      onClick={event => { event.stopPropagation(); hide(); }}
      onKeyDown={event => {
        if (event.key === "Escape") hide();
        if (event.key === "Enter") event.stopPropagation();
      }}
      onMouseEnter={event => showAfterDelay({x:event.clientX,y:event.clientY})}
      onMouseMove={event => {
        const next = {x:event.clientX,y:event.clientY};
        position.current = next;
        if (tooltip) setTooltip(next);
      }}
      onMouseLeave={hide}
      onFocus={event => {
        const bounds = event.currentTarget.getBoundingClientRect();
        showAfterDelay({x:bounds.left,y:bounds.bottom});
      }}
      onBlur={hide}
    >
      {children}
      {tooltip && createPortal(
        <span className="tcgplayer-tooltip" id={tooltipId} role="tooltip"
          style={{left:`clamp(0px, ${tooltip.x+12}px, calc(100vw - 120px))`,
            top:`clamp(0px, ${tooltip.y+14}px, calc(100vh - 28px))`}}>
          Open in TCG Player
        </span>,
        anchor.current?.closest("dialog") ?? document.body,
      )}
    </a>
  );
}
