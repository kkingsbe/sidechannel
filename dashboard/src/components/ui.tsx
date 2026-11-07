import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import * as Dialog from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { X, XCircle, MessageSquare, Wrench, CheckCircle2, Play, AlertCircle, Inbox, LoaderCircle, type LucideIcon } from "lucide-react";
import { cn, pretty } from "../lib/utils";
import type { IconName, Tone } from "../lib/status";
import { WorkspaceTitleContext } from "../lib/workspace-context";
const buttonVariants = cva("button", {
  variants: {
    variant: {
      default: "button-primary",
      secondary: "button-secondary",
      ghost: "button-ghost",
      destructive: "button-destructive",
    },
    size: { default: "", sm: "button-sm", icon: "button-icon" },
  },
  defaultVariants: { variant: "default", size: "default" },
});
export function Button({
  className,
  variant,
  size,
  asChild,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
export function Card({ className, ...props }: React.ComponentProps<"section">) {
  return <section className={cn("card", className)} {...props} />;
}
export function CardHeading({
  title,
  description,
  actions,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div className="card-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}
const toneClass: Record<Tone, string> = {
  neutral: "",
  info: "",
  success: "badge-success",
  warning: "badge-warning",
  danger: "badge-danger",
};
export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: Tone;
  children?: React.ReactNode;
}) {
  return <span className={cn("badge", toneClass[tone])}>{children}</span>;
}
const eventIcon: Record<IconName, LucideIcon> = {
  error: XCircle,
  board: MessageSquare,
  tool: Wrench,
  success: CheckCircle2,
  default: Play,
};
export function EventIcon({ name, size = 13 }: { name: IconName; size?: number }) {
  const Icon = eventIcon[name];
  return <Icon size={size} aria-hidden="true" />;
}
export function Field({
  label,
  hint,
  error,
  children,
  className,
  required,
}: {
  label: string;
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
  className?: string;
  required?: boolean;
}) {
  const id = React.useId();
  return (
    <div className={cn("field", className)}>
      <div><label htmlFor={id}>{label}</label>{required && <span className="required-label"> (required)</span>}</div>
      {React.Children.map(children, (child, index) => React.isValidElement(child) && index === 0
        ? React.cloneElement(
            child as React.ReactElement<Record<string, unknown>>,
            {
              id,
              "aria-describedby": hint || error ? id + "-hint" : undefined,
              "aria-invalid": !!error,
              ...(required ? { required: true, "aria-required": true } : {}),
            },
          )
        : child)}
      {(hint || error) && (
        <span
          id={id + "-hint"}
          className={error ? "field-error" : "field-hint"}
        >
          {error || hint}
        </span>
      )}
    </div>
  );
}
export function Input(props: React.ComponentProps<"input">) {
  return <input {...props} className={cn("input", props.className)} />;
}
export function Textarea({ expandable, editorLabel = "text", ...props }: React.ComponentProps<"textarea"> & { expandable?: boolean; editorLabel?: string }) {
  const [expanded, setExpanded] = React.useState(false);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  const field = (
    <textarea ref={ref} rows={5} {...props}
      className={cn("input textarea", expanded && "textarea-expanded", props.className)} />
  );
  if (!expandable) return field;
  return (
    <div className="prose-editor">{field}<Button type="button" size="sm" variant="ghost" aria-expanded={expanded}
      onClick={() => { setExpanded(!expanded); ref.current?.focus(); }}>{expanded ? "Collapse" : "Expand"} {editorLabel} editor</Button></div>
  );
}
export function Select(props: React.ComponentProps<"select">) {
  return <select {...props} className={cn("input select", props.className)} />;
}
export function Check({
  label,
  ...props
}: React.ComponentProps<"input"> & { label: string }) {
  return (
    <label className="check">
      <input type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}
export function Notice({
  children,
  kind = "info",
}: {
  children: React.ReactNode;
  kind?: "info" | "error" | "success" | "warning";
}) {
  return (
    <div
      className={cn("notice", "notice-" + kind)}
      role={kind === "error" ? "alert" : "status"}
    >
      <AlertCircle size={17} aria-hidden="true" />
      <div>{children}</div>
    </div>
  );
}
export function Empty({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="empty">
      <Inbox size={28} aria-hidden="true" />
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {children}
    </div>
  );
}
export function Loading({ label = "Loading workspace…" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" size={19} aria-hidden="true" />
      {label}
    </div>
  );
}
export function ErrorState({
  error,
  retry,
}: {
  error: unknown;
  retry?: () => void;
}) {
  return (
    <Notice kind="error">
      <strong>Could not load this workspace.</strong>
      <p>{error instanceof Error ? error.message : String(error)}</p>
      {retry && (
        <Button variant="secondary" size="sm" onClick={retry}>
          Try again
        </Button>
      )}
    </Notice>
  );
}
export function Drawer({
  title,
  description,
  open,
  onOpenChange,
  children,
  wide = false,
}: {
  title: string;
  description?: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  const opener = React.useRef<HTMLElement | null>(null);
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="drawer-overlay" />
        <Dialog.Content className={cn("drawer", wide && "drawer-wide")}
          onOpenAutoFocus={() => { opener.current = document.activeElement as HTMLElement; }}
          onCloseAutoFocus={event => {
            event.preventDefault();
            if (opener.current?.isConnected) opener.current.focus();
            else document.getElementById("main")?.focus();
          }}>
          <div className="drawer-heading">
            <div>
              <span className="eyebrow">Evidence inspector</span>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>
                {description ??
                  "Recorded evidence. Content is displayed as untrusted text."}
              </Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button
                aria-label="Close evidence inspector"
                variant="ghost"
                size="icon"
              >
                <X size={20} />
              </Button>
            </Dialog.Close>
          </div>
          <div className="drawer-content">{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function JsonView({
  value,
  title = "Recorded payload",
  open = false,
}: {
  value: unknown;
  title?: string;
  open?: boolean;
}) {
  let display = value;
  if (typeof value === "string") {
    try {
      display = JSON.parse(value);
    } catch {
      /* Preserve ordinary text verbatim. */
    }
  }
  return (
    <details className="json-view" open={open}>
      <summary>{title}</summary>
      <pre>{pretty(display)}</pre>
    </details>
  );
}
export function Tabs({
  value,
  onChange,
  items,
  panelId = "workspace-view-panel",
}: {
  value: string;
  onChange: (value: string) => void;
  items: { id: string; label: string; count?: number }[];
  panelId?: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label="Workspace views">
      {items.map((item, index) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          id={`${panelId}-tab-${item.id}`}
          aria-controls={panelId}
          aria-selected={value === item.id}
          tabIndex={value === item.id ? 0 : -1}
          className={cn("tab", value === item.id && "active")}
          onClick={() => onChange(item.id)}
          onKeyDown={(event) => {
            const next = event.key === "ArrowRight" ? (index + 1) % items.length
              : event.key === "ArrowLeft" ? (index - 1 + items.length) % items.length
              : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : undefined;
            if (next === undefined) return;
            event.preventDefault();
            onChange(items[next].id);
            document.getElementById(`${panelId}-tab-${items[next].id}`)?.focus();
          }}
        >
          {item.label}
          {item.count !== undefined && <span>{item.count}</span>}
        </button>
      ))}
    </div>
  );
}
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description: string;
  eyebrow?: string;
  actions?: React.ReactNode;
}) {
  const setWorkspaceTitle = React.useContext(WorkspaceTitleContext);
  React.useEffect(() => { setWorkspaceTitle(title); }, [title, setWorkspaceTitle]);
  return (
    <header className="page-heading">
      <div>
        {eyebrow && <span className="eyebrow">{eyebrow}</span>}
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {actions && <div className="actions">{actions}</div>}
    </header>
  );
}
export function Table({
  headers,
  children,
  label,
}: {
  headers: string[];
  children: React.ReactNode;
  label: string;
}) {
  return (
    <div className="table-scroll">
      <table aria-label={label}>
        <thead>
          <tr>
            {headers.map((h) => (
              <th key={h} scope="col">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
export function Pager({
  page,
  hasMore,
  onChange,
}: {
  page: number;
  hasMore: boolean;
  onChange: (n: number) => void;
}) {
  return (
    <div className="pager">
      <span>Page {page + 1}</span>
      <Button
        variant="secondary"
        size="sm"
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
      >
        Previous
      </Button>
      <Button
        variant="secondary"
        size="sm"
        disabled={!hasMore}
        onClick={() => onChange(page + 1)}
      >
        Next
      </Button>
    </div>
  );
}
