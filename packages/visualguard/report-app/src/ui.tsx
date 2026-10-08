import type { ReactNode } from "react";
import { STATUS_LABEL, type Status } from "./data";

const STATUS_STYLE: Record<Status, string> = {
  pass: "bg-emerald-50 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-950 dark:text-emerald-300 dark:ring-emerald-400/30",
  accepted:
    "bg-teal-50 text-teal-800 ring-teal-600/20 dark:bg-teal-950 dark:text-teal-300 dark:ring-teal-400/30",
  review:
    "bg-amber-50 text-amber-900 ring-amber-600/30 dark:bg-amber-950 dark:text-amber-300 dark:ring-amber-400/30",
  regression:
    "bg-rose-50 text-rose-800 ring-rose-600/20 dark:bg-rose-950 dark:text-rose-300 dark:ring-rose-400/30",
  error:
    "bg-red-100 text-red-900 ring-red-700/30 dark:bg-red-950 dark:text-red-300 dark:ring-red-400/30",
};

const STATUS_ICON_COLOR: Record<Status, string> = {
  pass: "text-emerald-600 dark:text-emerald-400",
  accepted: "text-teal-600 dark:text-teal-400",
  review: "text-amber-600 dark:text-amber-400",
  regression: "text-rose-600 dark:text-rose-400",
  error: "text-red-700 dark:text-red-400",
};

export function StatusIcon({
  status,
  className = "size-4",
}: {
  status: Status;
  className?: string;
}) {
  const color = STATUS_ICON_COLOR[status];
  const common = {
    className: `${className} shrink-0 ${color}`,
    viewBox: "0 0 20 20",
    fill: "currentColor",
    "aria-hidden": true,
  };
  switch (status) {
    case "pass":
    case "accepted":
      return (
        <svg {...common}>
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
            clipRule="evenodd"
          />
        </svg>
      );
    case "review":
      return (
        <svg {...common}>
          <path
            fillRule="evenodd"
            d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495ZM10 5a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 5Zm0 9a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
            clipRule="evenodd"
          />
        </svg>
      );
    case "regression":
      return (
        <svg {...common}>
          <path
            fillRule="evenodd"
            d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.28 7.22a.75.75 0 0 0-1.06 1.06L8.94 10l-1.72 1.72a.75.75 0 1 0 1.06 1.06L10 11.06l1.72 1.72a.75.75 0 1 0 1.06-1.06L11.06 10l1.72-1.72a.75.75 0 0 0-1.06-1.06L10 8.94 8.28 7.22Z"
            clipRule="evenodd"
          />
        </svg>
      );
    case "error":
      return (
        <svg {...common}>
          <path
            fillRule="evenodd"
            d="M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Zm-8-5a.75.75 0 0 1 .75.75v4.5a.75.75 0 0 1-1.5 0v-4.5A.75.75 0 0 1 10 5Zm0 10a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
            clipRule="evenodd"
          />
        </svg>
      );
  }
}

export function StatusBadge({ status }: { status: Status }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${STATUS_STYLE[status]}`}
    >
      <StatusIcon status={status} className="size-3.5" />
      {STATUS_LABEL[status]}
    </span>
  );
}

export function Pill({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300 ${className}`}
    >
      {children}
    </span>
  );
}

export function SectionTitle({ children, id }: { children: ReactNode; id?: string }) {
  return (
    <h3
      id={id}
      className="mb-2 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400"
    >
      {children}
    </h3>
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="rounded border border-slate-300 bg-slate-50 px-1 font-mono text-[11px] text-slate-600 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300">
      {children}
    </kbd>
  );
}

export function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; label: string; shortcut?: string; disabled?: boolean }>;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex rounded-lg bg-slate-100 p-0.5 dark:bg-slate-800"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={value === option.value}
          disabled={option.disabled}
          title={option.shortcut ? `${option.label} (${option.shortcut})` : option.label}
          onClick={() => onChange(option.value)}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
            value === option.value
              ? "bg-white text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white"
              : "text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        void navigator.clipboard?.writeText(text);
        const button = event.currentTarget;
        button.textContent = "Copied";
        setTimeout(() => (button.textContent = label), 1200);
      }}
      className="rounded-md border border-slate-300 px-2 py-0.5 text-xs font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800"
    >
      {label}
    </button>
  );
}
