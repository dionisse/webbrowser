import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { IconButton } from './Primitives';

/* ----------------------------------------------------------------- Field -- */

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  children: ReactNode;
  className?: string;
  htmlFor?: string;
}

export const Field = ({ label, hint, error, children, className = '', htmlFor }: FieldProps) => (
  <div className={`nb-field ${className} ${error ? 'nb-field--invalid' : ''}`.trim()}>
    {label ? (
      <label className="nb-label" htmlFor={htmlFor}>
        <span>{label}</span>
        {hint ? <span className="hint">{hint}</span> : null}
      </label>
    ) : null}
    {children}
    {error ? <span className="nb-error">{error}</span> : null}
  </div>
);

/* ----------------------------------------------------------------- Input -- */

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  mono?: boolean;
  affix?: ReactNode;
  wrapClass?: string;
}

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { label, hint, error, mono, affix, wrapClass = '', className = '', id, ...rest },
  ref,
) {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={inputId} className={wrapClass}>
      <div className={`nb-control${affix ? ' nb-control--affix' : ''}`}>
        <input ref={ref} id={inputId} className={`nb-input${mono ? ' nb-input--mono' : ''} ${className}`.trim()} {...rest} />
        {affix ? <div className="nb-affix">{affix}</div> : null}
      </div>
    </Field>
  );
});

/* --------------------------------------------------------- PasswordInput -- */

export interface PasswordInputProps extends Omit<TextInputProps, 'type' | 'affix'> {
  onGenerate?: () => void;
  generateLabel?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(function PasswordInput(
  { onGenerate, generateLabel = 'Générer', ...rest },
  ref,
) {
  const [shown, setShown] = useState(false);
  return (
    <TextInput
      ref={ref}
      {...rest}
      type={shown ? 'text' : 'password'}
      mono={shown}
      affix={
        <>
          {onGenerate ? (
            <IconButton label={generateLabel} size="sm" onClick={onGenerate} type="button">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 2v6h-6" />
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M3 22v-6h6" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
              </svg>
            </IconButton>
          ) : null}
          <IconButton label={shown ? 'Masquer' : 'Afficher'} size="sm" onClick={() => setShown((s) => !s)} type="button" on={shown}>
            {shown ? <EyeOff size={15} /> : <Eye size={15} />}
          </IconButton>
        </>
      }
    />
  );
});

/* -------------------------------------------------------------- Textarea -- */

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  wrapClass?: string;
}

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, hint, error, wrapClass = '', className = '', id, ...rest },
  ref,
) {
  const auto = useId();
  const areaId = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={areaId} className={wrapClass}>
      <textarea ref={ref} id={areaId} className={`nb-textarea ${className}`.trim()} {...rest} />
    </Field>
  );
});

/* ---------------------------------------------------------------- Select -- */

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  options: { value: string; label: string }[];
  wrapClass?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { label, hint, error, options, wrapClass = '', className = '', id, ...rest },
  ref,
) {
  const auto = useId();
  const selectId = id ?? auto;
  return (
    <Field label={label} hint={hint} error={error} htmlFor={selectId} className={wrapClass}>
      <div className="nb-control">
        <select ref={ref} id={selectId} className={`nb-select ${className}`.trim()} {...rest}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="nb-select-chevron">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m6 9 6 6 6-6" />
          </svg>
        </span>
      </div>
    </Field>
  );
});

/* ---------------------------------------------------------------- Switch -- */

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  title?: ReactNode;
  sub?: ReactNode;
  disabled?: boolean;
  id?: string;
}

export const Switch = ({ checked, onChange, title, sub, disabled, id }: SwitchProps) => {
  const auto = useId();
  const inputId = id ?? auto;
  return (
    <label className="nb-switch" htmlFor={inputId}>
      <input id={inputId} type="checkbox" role="switch" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="nb-switch__track">
        <span className="nb-switch__thumb" />
      </span>
      {title || sub ? (
        <span className="nb-switch__text">
          {title ? <span className="nb-switch__title">{title}</span> : null}
          {sub ? <span className="nb-switch__sub">{sub}</span> : null}
        </span>
      ) : null}
    </label>
  );
};

/* ------------------------------------------------------------- Segmented -- */

export interface SegmentedProps<T extends string> {
  value: T;
  options: { value: T; label: ReactNode; icon?: ReactNode }[];
  onChange: (next: T) => void;
  tone?: 'neutral' | 'ember';
  ariaLabel?: string;
  className?: string;
}

export function Segmented<T extends string>({ value, options, onChange, tone = 'neutral', ariaLabel, className = '' }: SegmentedProps<T>) {
  return (
    <div className={`nb-segmented${tone === 'ember' ? ' nb-segmented--ember' : ''} ${className}`.trim()} role="group" aria-label={ariaLabel}>
      {options.map((o) => (
        <button key={o.value} type="button" data-on={value === o.value} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          <span className="nb-row nb-gap-2">
            {o.icon}
            {o.label}
          </span>
        </button>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------- Slider -- */

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (next: number) => void;
  label?: ReactNode;
  display?: ReactNode;
}

export const Slider = ({ value, min, max, step = 1, onChange, label, display }: SliderProps) => {
  const id = useId();
  return (
    <div className="nb-field">
      {label ? (
        <label className="nb-label" htmlFor={id}>
          <span>{label}</span>
          <span className="hint" style={{ marginLeft: 'auto', fontVariantNumeric: 'tabular-nums' }}>
            {display ?? value}
          </span>
        </label>
      ) : null}
      <input id={id} className="nb-slider" type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
    </div>
  );
};
