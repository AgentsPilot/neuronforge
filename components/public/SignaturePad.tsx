'use client';

/**
 * Where the client draws their signature.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * POINTER EVENTS, NOT MOUSE AND TOUCH
 *
 * One set of handlers covers a mouse, a finger and a stylus, including pressure
 * and a pen's eraser if it has one. Handling `mousedown` and `touchstart`
 * separately is the usual approach and it is how signature pads end up working
 * on a desk and not on the phone where most clients actually open the link —
 * the two event families fire in different orders, and a touch that also
 * synthesises mouse events draws every stroke twice.
 *
 * `touch-action: none` is what stops a drag from scrolling the page instead of
 * drawing. Without it the pad is unusable on a phone, which is the device this
 * exists for.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DRAWN AT DEVICE RESOLUTION
 *
 * The canvas is sized to `devicePixelRatio` and scaled back down in CSS, so the
 * stroke is sharp on a phone rather than the soft doubled line a 1:1 canvas
 * gives on a 3x screen. It is also what the PDF receives, and a blurry
 * signature on a contract looks like a photocopy of a photocopy.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Eraser } from 'lucide-react';

interface Props {
  /** Fires with a PNG data URI, or null when the pad is cleared. */
  onChange: (dataUrl: string | null) => void;
  label: string;
  clearLabel: string;
  hint?: string;
  disabled?: boolean;
}

/** Trimmed to the ink, so the PDF is not mostly empty canvas. */
const PAD_HEIGHT = 150;

export function SignaturePad({ onChange, label, clearLabel, hint, disabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);
  /** The ink's bounds, so the exported PNG can be cropped to the stroke. */
  const bounds = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  /** Sized to the element, at device resolution. Re-run on resize. */
  const fit = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 3);
    const width = canvas.clientWidth;
    /*
     * Only when the backing store is actually wrong. Assigning width or height
     * CLEARS the canvas, so doing it unconditionally on every resize — which
     * fires when a phone's address bar hides — would wipe a signature the
     * client had already drawn.
     */
    if (canvas.width === Math.round(width * ratio) && canvas.height === Math.round(PAD_HEIGHT * ratio)) {
      return;
    }
    canvas.width = Math.round(width * ratio);
    canvas.height = Math.round(PAD_HEIGHT * ratio);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#111827';
  }, []);

  useEffect(() => {
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit]);

  function positionOf(event: React.PointerEvent<HTMLCanvasElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }

  function start(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    /*
     * Capture, so a stroke that leaves the pad mid-flight still ends cleanly.
     * Without it, lifting the finger outside the box leaves `drawing` true and
     * the next touch anywhere continues the old stroke.
     */
    canvas.setPointerCapture(event.pointerId);
    drawing.current = true;

    const { x, y } = positionOf(event);
    ctx.beginPath();
    ctx.moveTo(x, y);
    bounds.current = bounds.current ?? { minX: x, minY: y, maxX: x, maxY: y };
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current || disabled) return;
    const ctx = canvasRef.current?.getContext('2d');
    if (!ctx) return;

    const { x, y } = positionOf(event);
    ctx.lineTo(x, y);
    ctx.stroke();

    const b = bounds.current;
    if (b) {
      b.minX = Math.min(b.minX, x);
      b.minY = Math.min(b.minY, y);
      b.maxX = Math.max(b.maxX, x);
      b.maxY = Math.max(b.maxY, y);
    }
    if (!hasInk) setHasInk(true);
  }

  function end(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return;
    drawing.current = false;
    canvasRef.current?.releasePointerCapture(event.pointerId);
    emit();
  }

  /**
   * Export, cropped to the ink with a small margin.
   *
   * An uncropped pad is mostly white, and placed on a PDF it draws a signature
   * floating in a box of nothing. Cropping to the stroke means the mark sits on
   * the page at the size it was drawn.
   */
  function emit() {
    const canvas = canvasRef.current;
    const b = bounds.current;
    if (!canvas || !b) return onChange(null);

    const ratio = canvas.width / canvas.clientWidth;
    const pad = 6;
    const sx = Math.max(0, (b.minX - pad) * ratio);
    const sy = Math.max(0, (b.minY - pad) * ratio);
    const sw = Math.min(canvas.width - sx, (b.maxX - b.minX + pad * 2) * ratio);
    const sh = Math.min(canvas.height - sy, (b.maxY - b.minY + pad * 2) * ratio);

    /* A dot is not a signature, and neither is a stray tap while scrolling. */
    if (sw < 8 || sh < 4) return onChange(null);

    const out = document.createElement('canvas');
    out.width = Math.round(sw);
    out.height = Math.round(sh);
    const ctx = out.getContext('2d');
    if (!ctx) return onChange(null);
    /*
     * No white fill: a transparent PNG sits on whatever the PDF or the page
     * puts behind it, where a white rectangle would print a visible patch on
     * any letterhead that is not pure white.
     */
    ctx.drawImage(canvas, sx, sy, sw, sh, 0, 0, out.width, out.height);
    onChange(out.toDataURL('image/png'));
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    bounds.current = null;
    setHasInk(false);
    onChange(null);
  }

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-3">
        <span className="text-xs font-medium" style={{ color: 'var(--ap-text-muted)' }}>
          {label}
        </span>
        {hasInk && !disabled && (
          <button
            type="button"
            onClick={clear}
            className="inline-flex items-center gap-1 text-xs"
            style={{ color: 'var(--ap-text-muted)' }}
          >
            <Eraser className="h-3.5 w-3.5" />
            {clearLabel}
          </button>
        )}
      </div>

      <canvas
        ref={canvasRef}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
        /* `touch-action: none` or a finger scrolls the page instead of drawing. */
        style={{
          touchAction: 'none',
          width: '100%',
          height: PAD_HEIGHT,
          background: 'var(--ap-surface)',
          border: '1px solid var(--ap-border)',
          borderRadius: 'var(--ap-radius-sm)',
          cursor: disabled ? 'not-allowed' : 'crosshair',
          display: 'block',
        }}
      />

      {hint && !hasInk && (
        <p className="mt-1.5 text-center text-xs" style={{ color: 'var(--ap-text-muted)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}
