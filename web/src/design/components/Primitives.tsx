import {
  forwardRef,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type ReactNode,
} from 'react';

/* ---------------------------------------------------------------- Button -- */

type Variant = 'primary' | 'secondary' | 'ghost' | 'quiet' | 'danger' | 'sage';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  block?: boolean;
  icon?: boolean;
  loading?: boolean;
  children?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', block, icon, loading, className = '', children, disabled, ...rest },
  ref,
) {
  const cls = [
    'nb-btn',
    variant !== 'secondary' ? `nb-btn--${variant}` : '',
    size !== 'md' ? `nb-btn--${size}` : '',
    block ? 'nb-btn--block' : '',
    icon ? 'nb-btn--icon' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button ref={ref} className={cls} disabled={disabled || loading} {...rest}>
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
});

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string;
  size?: 'sm' | 'md' | 'lg';
  on?: boolean;
  children: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, size = 'md', on, className = '', children, ...rest },
  ref,
) {
  const cls = ['nb-iconbtn', size !== 'md' ? `nb-iconbtn--${size}` : '', on ? 'nb-iconbtn--on' : '', className].filter(Boolean).join(' ');
  return (
    <button ref={ref} className={cls} aria-label={label} title={label} {...rest}>
      {children}
    </button>
  );
});

/* --------------------------------------------------------------- Spinner -- */

export const Spinner = ({ large }: { large?: boolean }) => <span className={`nb-spinner${large ? ' nb-spinner--lg' : ''}`} aria-hidden />;

/* ------------------------------------------------------------------ Chip -- */

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: 'neutral' | 'ember' | 'sage' | 'warn' | 'clay';
  on?: boolean;
  as?: 'button' | 'span';
}

export const Chip = forwardRef<HTMLButtonElement, ChipProps>(function Chip(
  { tone = 'neutral', on, as = 'button', className = '', children, ...rest },
  ref,
) {
  const toneClass = on
    ? 'nb-chip--on'
    : tone === 'ember'
      ? 'nb-chip--on'
      : tone === 'sage'
        ? 'nb-chip--sage'
        : tone === 'warn'
          ? 'nb-chip--warn'
          : tone === 'clay'
            ? 'nb-chip--clay'
            : '';
  const cls = ['nb-chip', toneClass, className].filter(Boolean).join(' ');
  if (as === 'span') return <span className={cls}>{children}</span>;
  return (
    <button ref={ref} type="button" className={cls} aria-pressed={on} {...rest}>
      {children}
    </button>
  );
});

/* ----------------------------------------------------------------- Badge -- */

export const Badge = ({ tone = 'neutral', children, className = '' }: { tone?: 'neutral' | 'ember' | 'sage' | 'warn'; children: ReactNode; className?: string }) => (
  <span className={`nb-badge${tone !== 'neutral' ? ` nb-badge--${tone}` : ''} ${className}`.trim()}>{children}</span>
);

export const Dot = ({ tone = 'slate', live }: { tone?: 'slate' | 'ember' | 'sage' | 'live'; live?: boolean }) => (
  <span
    className={`nb-dot${tone === 'ember' ? ' nb-dot--ember' : ''}${live || tone === 'live' ? ' nb-dot--live' : ''}`}
    style={tone === 'sage' ? { background: 'var(--sage-500)', boxShadow: '0 0 0 3px var(--sage-tint)' } : undefined}
    aria-hidden
  />
);

/* ------------------------------------------------------------------ Card -- */

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  interactive?: boolean;
  raised?: boolean;
  flush?: boolean;
  pad?: number | string;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { interactive, raised, flush, pad, className = '', style, children, ...rest },
  ref,
) {
  const cls = ['nb-card', interactive ? 'nb-card--interactive' : '', raised ? 'nb-card--raised' : '', flush ? 'nb-card--flush' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <div ref={ref} className={cls} style={{ ...(pad !== undefined ? { padding: typeof pad === 'number' ? `${pad}px` : pad } : {}), ...style }} {...rest}>
      {children}
    </div>
  );
});

export const Divider = ({ pad }: { pad?: boolean }) => <hr className={`nb-divider${pad ? ' nb-divider--pad' : ''}`} />;

export const SectionTitle = ({ title, count, action }: { title: ReactNode; count?: ReactNode; action?: ReactNode }) => (
  <div className="nb-section-title">
    <h2>{title}</h2>
    {count !== undefined ? <span className="count">{count}</span> : null}
    <span className="nb-grow" />
    {action}
  </div>
);

/* ---------------------------------------------------------------- Avatar -- */

export const Avatar = ({ label, hue = 20, size = 38, radius = 13 }: { label: string; hue?: number; size?: number; radius?: number }) => {
  const initials = label
    .split(/[\s._-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('') || '·';
  return (
    <span
      className="nb-avatar"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        fontSize: Math.round(size * 0.38),
        background: `linear-gradient(150deg, hsl(${hue} 46% 26%), hsl(${hue} 58% 16%))`,
        border: `1px solid hsl(${hue} 42% 32% / .55)`,
      }}
      aria-hidden
    >
      {initials}
    </span>
  );
};

/* ----------------------------------------------------------------- Meter -- */

export const Meter = ({ value, tone = 'ember', height = 6 }: { value: number; tone?: 'ember' | 'sage' | 'warn' | 'slate'; height?: number }) => (
  <div className="nb-meter" style={{ height }} role="progressbar" aria-valuenow={Math.round(value * 100)} aria-valuemin={0} aria-valuemax={100}>
    <div
      className={`nb-meter__fill${tone !== 'ember' ? ` nb-meter__fill--${tone}` : ''}`}
      style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%` }}
    />
  </div>
);

export const Progress = () => (
  <div className="nb-progress" role="progressbar" aria-label="loading">
    <div className="nb-progress__bar" />
  </div>
);

export const Kbd = ({ children }: { children: ReactNode }) => <kbd className="nb-kbd">{children}</kbd>;

export const Skeleton = ({ w = '100%', h = 14, r = 8 }: { w?: number | string; h?: number; r?: number }) => (
  <div className="nb-skeleton" style={{ width: typeof w === 'number' ? `${w}px` : w, height: h, borderRadius: r }} />
);

/* ------------------------------------------------------------- EmptyState -- */

export const EmptyState = ({ icon, title, sub, action }: { icon?: ReactNode; title: ReactNode; sub?: ReactNode; action?: ReactNode }) => (
  <div className="nb-empty">
    {icon ? <div className="nb-empty__icon">{icon}</div> : null}
    <div className="nb-empty__title">{title}</div>
    {sub ? <div className="nb-empty__sub">{sub}</div> : null}
    {action}
  </div>
);

/* --------------------------------------------------------------- Tooltip -- */

export const Tooltip = ({ label, children, side = 'bottom' }: { label: string; children: ReactNode; side?: 'top' | 'bottom' }) => {
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const host = useRef<HTMLSpanElement>(null);
  const id = useId();

  const show = () => {
    const r = host.current?.getBoundingClientRect();
    if (!r) return;
    setPos({ x: r.left + r.width / 2, y: side === 'top' ? r.top - 8 : r.bottom + 8 });
  };

  return (
    <span ref={host} onMouseEnter={show} onMouseLeave={() => setPos(null)} onFocus={show} onBlur={() => setPos(null)} style={{ display: 'inline-flex' }} aria-describedby={pos ? id : undefined}>
      {children}
      {pos ? (
        <span
          id={id}
          role="tooltip"
          className="nb-tooltip"
          style={{ left: pos.x, top: pos.y, transform: side === 'top' ? 'translate(-50%,-100%)' : 'translate(-50%,0)' }}
        >
          {label}
        </span>
      ) : null}
    </span>
  );
};

/* --------------------------------------------------------- ClickOutside -- */

export function useClickOutside<T extends HTMLElement>(onOutside: () => void, active = true) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onOutside();
    };
    document.addEventListener('mousedown', handler);
    document.addEventListener('touchstart', handler, { passive: true });
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', handler);
      document.removeEventListener('touchstart', handler);
      document.removeEventListener('keydown', key);
    };
  }, [onOutside, active]);
  return ref;
}

/* --------------------------------------------------------------- Layout -- */

export const Row = ({ gap = 3, wrap, grow, between, center, className = '', style, children }: { gap?: number; wrap?: boolean; grow?: boolean; between?: boolean; center?: boolean; className?: string; style?: HTMLAttributes<HTMLDivElement>['style']; children: ReactNode }) => (
  <div className={`nb-row nb-gap-${gap}${wrap ? ' nb-wrap' : ''}${grow ? ' nb-grow' : ''}${between ? ' nb-between' : ''}${center ? ' nb-center' : ''} ${className}`.trim()} style={style}>
    {children}
  </div>
);

export const Stack = ({ gap = 3, className = '', style, children }: { gap?: number; className?: string; style?: HTMLAttributes<HTMLDivElement>['style']; children: ReactNode }) => (
  <div className={`nb-stack nb-gap-${gap} ${className}`.trim()} style={style}>
    {children}
  </div>
);
