import { Eraser } from 'lucide-react';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, type PointerEvent } from 'react';
import { Button } from '../../components/ui/Button';

export interface SignaturePadHandle {
  toDataUrl: () => string;
  clear: () => void;
}

interface Props {
  labelId: string;
  onChange: (hasInk: boolean) => void;
}

/** Área de assinatura com dedo, caneta ou mouse. Exporta PNG. */
export const SignaturePad = forwardRef<SignaturePadHandle, Props>(function SignaturePad({ labelId, onChange }, ref) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const inked = useRef(false);

  const setup = useCallback(() => {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    const { width, height } = el.getBoundingClientRect();
    el.width = Math.round(width * ratio);
    el.height = Math.round(height * ratio);
    ctx.scale(ratio, ratio);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = 2.2;
    ctx.strokeStyle = '#1d2327';
    inked.current = false;
    onChange(false);
  }, [onChange]);

  useEffect(() => {
    setup();
  }, [setup]);

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const down = (e: PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = true;
    last.current = point(e);
  };

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const ctx = e.currentTarget.getContext('2d');
    if (!ctx) return;
    const p = point(e);
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (!inked.current) {
      inked.current = true;
      onChange(true);
    }
  };

  const up = () => {
    drawing.current = false;
    last.current = null;
  };

  useImperativeHandle(ref, () => ({
    toDataUrl: () => canvas.current?.toDataURL('image/png') ?? '',
    clear: setup,
  }));

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvas}
        role="img"
        aria-labelledby={labelId}
        className="h-44 w-full touch-none rounded-lg border border-dashed border-line-strong bg-white"
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
      />
      <div className="flex items-center justify-between text-xs text-muted">
        <span>Assine com o dedo, a caneta ou o mouse.</span>
        <Button size="sm" variant="ghost" icon={<Eraser className="size-4" aria-hidden />} onClick={setup}>
          Limpar
        </Button>
      </div>
    </div>
  );
});
