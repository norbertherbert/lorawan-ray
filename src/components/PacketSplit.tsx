import { useEffect, useRef, useState, type ReactNode } from 'react';

const STORAGE_KEY = 'lora-manta.packet-split.v1';
const TABLE_MIN = 160;
const DETAILS_MIN = 240;
const HANDLE_HEIGHT = 12;

function savedSplit() {
  try {
    const value = Number(window.localStorage.getItem(STORAGE_KEY));
    if (value > 0 && value < 1) return value;
  } catch { /* Storage may be disabled. */ }
  return 0.45;
}

export default function PacketSplit({ expanded, table, children }: {
  expanded: boolean;
  table: ReactNode;
  children: ReactNode;
}) {
  const container = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; offset: number } | null>(null);
  const [ratio, setRatio] = useState(savedSplit);
  const [height, setHeight] = useState(0);
  const [dragging, setDragging] = useState(false);
  const available = Math.max(TABLE_MIN + DETAILS_MIN, height - HANDLE_HEIGHT);
  const tableHeight = Math.max(TABLE_MIN, Math.min(available - DETAILS_MIN, available * ratio));

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setHeight(element.getBoundingClientRect().height));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (dragging) return;
    try { window.localStorage.setItem(STORAGE_KEY, String(ratio)); } catch { /* Optional preference. */ }
  }, [ratio, dragging]);

  const resize = (pixels: number) => {
    setRatio(Math.max(TABLE_MIN, Math.min(available - DETAILS_MIN, pixels)) / available);
  };

  return (
    <div
      ref={container}
      className={`analyzer-workspace${expanded ? '' : ' details-collapsed'}${dragging ? ' is-resizing' : ''}`}
      style={expanded ? { gridTemplateRows: `${tableHeight}px ${HANDLE_HEIGHT}px minmax(${DETAILS_MIN}px, 1fr)` } : undefined}
    >
      {table}
      {expanded ? (
        <div
          className="packet-split-handle"
          role="separator"
          tabIndex={0}
          aria-label="Resize packet table and details"
          aria-orientation="horizontal"
          aria-controls="packet-details-content"
          aria-valuemin={Math.round(TABLE_MIN / available * 100)}
          aria-valuemax={Math.round((available - DETAILS_MIN) / available * 100)}
          aria-valuenow={Math.round(tableHeight / available * 100)}
          aria-valuetext={`${Math.round(tableHeight / available * 100)} percent for packet table`}
          onPointerDown={(event) => {
            if (!event.isPrimary || event.button !== 0) return;
            event.preventDefault();
            event.currentTarget.focus();
            event.currentTarget.setPointerCapture(event.pointerId);
            drag.current = { id: event.pointerId, offset: event.clientY - event.currentTarget.getBoundingClientRect().top };
            setDragging(true);
          }}
          onPointerMove={(event) => {
            if (drag.current?.id !== event.pointerId || !container.current) return;
            resize(event.clientY - container.current.getBoundingClientRect().top - drag.current.offset);
          }}
          onPointerUp={(event) => {
            if (drag.current?.id !== event.pointerId) return;
            event.currentTarget.releasePointerCapture(event.pointerId);
            drag.current = null;
            setDragging(false);
          }}
          onLostPointerCapture={() => { drag.current = null; setDragging(false); }}
          onPointerCancel={() => { drag.current = null; setDragging(false); }}
          onDoubleClick={() => setRatio(0.45)}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 50 : 10;
            if (event.key === 'ArrowUp') resize(tableHeight - step);
            else if (event.key === 'ArrowDown') resize(tableHeight + step);
            else if (event.key === 'Home') resize(TABLE_MIN);
            else if (event.key === 'End') resize(available - DETAILS_MIN);
            else return;
            event.preventDefault();
          }}
        ><span aria-hidden="true" /></div>
      ) : null}
      {children}
    </div>
  );
}
