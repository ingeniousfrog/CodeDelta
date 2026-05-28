import type { ButtonHTMLAttributes, HTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'link';
type ButtonSize = 'md' | 'sm';

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant; size?: ButtonSize }) {
  const v =
    variant === 'link' ? 'btn-link' : `btn btn-${variant} btn-${size}`;
  return (
    <button type="button" className={`${v} ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

export function Card({
  children,
  className = '',
  muted,
  ...props
}: HTMLAttributes<HTMLDivElement> & { muted?: boolean }) {
  return (
    <div className={`card ${muted ? 'card-muted' : ''} ${className}`.trim()} {...props}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description }: { title: string; description?: string }) {
  return (
    <div className="card-header">
      <h2>{title}</h2>
      {description && <p className="form-hint">{description}</p>}
    </div>
  );
}

type BadgeVariant =
  | 'default'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'impact-low'
  | 'impact-medium'
  | 'impact-high'
  | 'impact-critical';

export function Badge({
  children,
  variant = 'default',
  className = '',
}: {
  children: ReactNode;
  variant?: BadgeVariant;
  className?: string;
}) {
  const cls = variant === 'default' ? 'badge' : `badge badge-${variant}`;
  return <span className={`${cls} ${className}`.trim()}>{children}</span>;
}

export function Alert({
  children,
  variant = 'error',
  title,
}: {
  children: ReactNode;
  variant?: 'error' | 'success' | 'warning';
  title?: string;
}) {
  return (
    <div className={`alert alert-${variant}`} role="alert">
      {title && <strong>{title}</strong>}
      {title ? <div style={{ marginTop: '0.35rem' }}>{children}</div> : children}
    </div>
  );
}

export function FormField({
  label,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  hint?: string;
  htmlFor?: string;
  children: ReactNode;
}) {
  return (
    <div className="form-field">
      <label htmlFor={htmlFor}>{label}</label>
      {children}
      {hint && <p className="form-hint">{hint}</p>}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
        <div>
          <h1>{title}</h1>
          {description && <p className="page-lead">{description}</p>}
        </div>
        {actions}
      </div>
    </header>
  );
}

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="empty-state">
      <p>
        <strong>{title}</strong>
      </p>
      {description && <p className="form-hint">{description}</p>}
    </div>
  );
}

export function Mono({ children }: { children: ReactNode }) {
  return <code className="mono">{children}</code>;
}

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input className="input" {...props} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className="select" {...props} />;
}

export function TextArea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className="textarea" {...props} />;
}

export function SelectableCard({
  selected,
  onSelect,
  title,
  description,
  disabled,
}: {
  selected: boolean;
  onSelect: () => void;
  title: string;
  description: string;
  disabled?: boolean;
}) {
  return (
    <label
      className={`selectable-card ${selected ? 'selected' : ''}`}
      style={disabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined}
    >
      <input type="radio" checked={selected} onChange={onSelect} disabled={disabled} />
      <div>
        <strong>{title}</strong>
        <p className="form-hint" style={{ margin: '0.25rem 0 0' }}>
          {description}
        </p>
      </div>
    </label>
  );
}
