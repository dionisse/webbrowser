import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { Button, IconButton, useClickOutside } from './Primitives';
import { useUi } from '../../state/ui';

/* ----------------------------------------------------------------- Modal -- */

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: 'narrow' | 'normal' | 'wide';
  dismissable?: boolean;
}

export const Modal = ({ open, onClose, title, subtitle, children, footer, width = 'normal', dismissable = true }: ModalProps) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissable) onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose, dismissable]);

  if (!open) return null;
  return (
    <div className="nb-backdrop" onMouseDown={(e) => dismissable && e.target === e.currentTarget && onClose()}>
      <div className={`nb-modal${width === 'wide' ? ' nb-modal--wide' : width === 'narrow' ? ' nb-modal--narrow' : ''}`} role="dialog" aria-modal="true">
        {title ? (
          <div className="nb-modal__head">
            <div className="nb-grow">
              <div className="nb-modal__title">{title}</div>
              {subtitle ? <div className="nb-modal__sub">{subtitle}</div> : null}
            </div>
            {dismissable ? (
              <IconButton label="Fermer" onClick={onClose}>
                <X size={17} />
              </IconButton>
            ) : null}
          </div>
        ) : null}
        <div className="nb-modal__body">{children}</div>
        {footer ? <div className="nb-modal__foot">{footer}</div> : null}
      </div>
    </div>
  );
};

/* ----------------------------------------------------------------- Sheet -- */

export const Sheet = ({ open, onClose, title, children, footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; footer?: ReactNode }) => {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="nb-backdrop" style={{ alignItems: 'flex-end', padding: 0 }} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="nb-sheet" role="dialog" aria-modal="true">
        <div className="nb-sheet__grab" />
        {title ? (
          <div className="nb-modal__head">
            <div className="nb-grow nb-modal__title">{title}</div>
            <IconButton label="Fermer" onClick={onClose}>
              <X size={17} />
            </IconButton>
          </div>
        ) : null}
        <div className="nb-modal__body">{children}</div>
        {footer ? <div className="nb-modal__foot">{footer}</div> : null}
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ Menu -- */

export interface MenuItem {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  onSelect?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separatorBefore?: boolean;
}

export const Menu = ({ items, onClose, style }: { items: MenuItem[]; onClose: () => void; style?: React.CSSProperties }) => {
  const ref = useClickOutside<HTMLDivElement>(onClose);
  return (
    <div className="nb-popover" ref={ref} style={style} role="menu">
      {items.map((item) => (
        <div key={item.id}>
          {item.separatorBefore ? <div className="nb-menu-sep" /> : null}
          <button
            type="button"
            className={`nb-menu-item${item.danger ? ' nb-menu-item--danger' : ''}`}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              item.onSelect?.();
              onClose();
            }}
          >
            {item.icon ? <span style={{ color: 'var(--text-tertiary)', display: 'inline-flex' }}>{item.icon}</span> : null}
            <span className="nb-grow truncate">{item.label}</span>
          </button>
        </div>
      ))}
    </div>
  );
};

/* --------------------------------------------------------- ConfirmDialog -- */

export interface ConfirmProps {
  open: boolean;
  title: ReactNode;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  requireText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

export const ConfirmDialog = ({ open, title, body, confirmLabel = 'Confirmer', cancelLabel = 'Annuler', danger, requireText, onConfirm, onCancel, busy }: ConfirmProps) => {
  const [typed, setTyped] = useState('');
  useEffect(() => {
    if (open) setTyped('');
  }, [open]);
  const satisfied = !requireText || typed.trim().toUpperCase() === requireText.toUpperCase();
  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      width="narrow"
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm} disabled={!satisfied || busy} loading={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {body ? <p style={{ color: 'var(--mist-500)', fontSize: 'var(--fs-body)', lineHeight: 1.6 }}>{body}</p> : null}
      {requireText ? (
        <div className="nb-field" style={{ marginTop: 16 }}>
          <input className="nb-input nb-input--mono" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={requireText} autoFocus />
        </div>
      ) : null}
    </Modal>
  );
};

/* ---------------------------------------------------------------- Toasts -- */

const TOAST_ICON = {
  info: Info,
  success: CheckCircle2,
  warn: AlertTriangle,
  danger: XCircle,
} as const;

const TOAST_COLOR = {
  info: 'var(--mist-500)',
  success: 'var(--sage-400)',
  warn: 'var(--warn-text)',
  danger: 'var(--ember-400)',
} as const;

export const ToastHost = () => {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  if (toasts.length === 0) return null;
  return (
    <div className="nb-toasts" aria-live="polite">
      {toasts.map((t) => {
        const Icon = TOAST_ICON[t.kind];
        return (
          <div key={t.id} className={`nb-toast nb-toast--${t.kind}`}>
            <span style={{ color: TOAST_COLOR[t.kind], marginTop: 1 }}>
              <Icon size={16} />
            </span>
            <div className="nb-grow">
              <div className="nb-toast__msg">{t.message}</div>
              {t.detail ? <div className="nb-toast__detail">{t.detail}</div> : null}
              {t.action ? (
                <button
                  type="button"
                  className="nb-chip nb-chip--on"
                  style={{ marginTop: 8, height: 26 }}
                  onClick={() => {
                    t.action?.run();
                    dismiss(t.id);
                  }}
                >
                  {t.action.label}
                </button>
              ) : null}
            </div>
            <IconButton label="Fermer" size="sm" onClick={() => dismiss(t.id)}>
              <X size={13} />
            </IconButton>
          </div>
        );
      })}
    </div>
  );
};

/* ------------------------------------------------------ AutofillPrompt ---- */

/**
 * Shown when a proxied page asks Nimbus to fill a form. The site never sees
 * the vault: it posts a message, the shell renders this prompt, and only the
 * fields the user approves are injected.
 */
export const AutofillPrompt = ({ open, site, username, onConfirm, onCancel }: { open: boolean; site: string; username: string; onConfirm: () => void; onCancel: () => void }) => {
  const t = useUi((s) => s.t);
  const [countdown, setCountdown] = useState(0);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!open) return;
    setCountdown(12);
    timer.current = window.setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          window.clearInterval(timer.current);
          onCancel();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer.current);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div
      style={{
        position: 'fixed',
        right: 18,
        bottom: 18,
        zIndex: 125,
        width: 'min(340px, calc(100vw - 36px))',
      }}
    >
      <div className="nb-card nb-card--raised anim-rise" style={{ borderRadius: 'var(--r-xl)', padding: 16 }}>
        <div className="nb-row nb-gap-3" style={{ alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--sage-400)', marginTop: 2 }}>
            <CheckCircle2 size={17} />
          </span>
          <div className="nb-grow">
            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--mist-100)' }}>{t('passwords.autofillPrompt', { site })}</div>
            <div className="tiny" style={{ marginTop: 3 }}>
              {username} · {countdown}s
            </div>
          </div>
          <IconButton label={t('common.close')} size="sm" onClick={onCancel}>
            <X size={13} />
          </IconButton>
        </div>
        <div className="nb-row nb-gap-2" style={{ marginTop: 14 }}>
          <Button size="sm" variant="primary" onClick={onConfirm} className="nb-grow">
            {t('passwords.autofillConfirm')}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>
            {t('passwords.autofillCancel')}
          </Button>
        </div>
      </div>
    </div>
  );
};
