import { MdMenu, MdMenuItem, MdOutlinedButton } from "../material";

export function HomeIcon() {
  return (
    <span slot="icon" className="material-icon">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
        <path d="M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8h5Z" />
      </svg>
    </span>
  );
}

export function SettingsIcon() {
  return (
    <span slot="icon" className="material-icon">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
        <path d="M19.43 12.98c.04-.32.07-.65.07-.98s-.03-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46a.5.5 0 0 0-.6-.22l-2.49 1a7.3 7.3 0 0 0-1.69-.98l-.38-2.65A.49.49 0 0 0 14 2h-4a.49.49 0 0 0-.5.42l-.38 2.65c-.61.25-1.18.59-1.69.98l-2.49-1a.49.49 0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.04.32-.07.65-.07.98s.03.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.12.22.37.3.6.22l2.49-1c.51.39 1.08.73 1.69.98l.38 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.38-2.65c.61-.25 1.18-.59 1.69-.98l2.49 1c.23.08.48 0 .6-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65ZM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5Z" />
      </svg>
    </span>
  );
}

export function WarningIcon() {
  return (
    <span className="warning-icon" aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="currentColor" focusable="false">
        <path d="M1 21h22L12 2 1 21Zm12-3h-2v-2h2v2Zm0-4h-2v-4h2v4Z" />
      </svg>
    </span>
  );
}

export function DiagnosticsIcon() {
  return (
    <span slot="icon" className="material-icon">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
        <path d="M3 13h4l2.2-6.6L13 18l2.2-6H21v2h-4.4L13 24 9.1 12.4 8.4 15H3v-2Z" />
      </svg>
    </span>
  );
}

export function ThermostatIcon() {
  return (
    <span className="preset-icon preset-custom" title="Custom temperature">
      <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
        <path d="M15 13V5a3 3 0 0 0-6 0v8a5 5 0 1 0 6 0Zm-3 8a3 3 0 0 1-1-5.83V5a1 1 0 0 1 2 0v10.17A3 3 0 0 1 12 21Z" />
      </svg>
      <span className="visually-hidden">Custom temperature</span>
    </span>
  );
}

export function ChevronDownIcon() {
  return (
    <svg className="dropdown-chevron" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="m7 10 5 5 5-5H7Z" />
    </svg>
  );
}

export function ToolbarDropdown({
  id,
  label,
  value,
  open,
  disabled = false,
  options,
  onOpenChange,
}: {
  id: string;
  label: string;
  value: string;
  open: boolean;
  disabled?: boolean;
  options: Array<{
    label: string;
    supportingText?: string;
    selected: boolean;
    onSelect: () => void;
  }>;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <div className="toolbar-dropdown">
      <MdOutlinedButton
        id={id}
        type="button"
        className="toolbar-dropdown-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${label}: ${value}`}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
      >
        <span className="toolbar-dropdown-trigger-label">
          <span>{label}</span>
          <strong>{value}</strong>
          <ChevronDownIcon />
        </span>
      </MdOutlinedButton>
      <MdMenu
        anchor={id}
        positioning="fixed"
        open={open}
        onClosed={() => onOpenChange(false)}
      >
        {options.map((option) => (
          <MdMenuItem
            type="option"
            selected={option.selected}
            key={option.label}
            onClick={() => {
              onOpenChange(false);
              if (!option.selected) option.onSelect();
            }}
          >
            <span slot="headline">{option.label}</span>
            {option.supportingText && (
              <span slot="supporting-text">{option.supportingText}</span>
            )}
          </MdMenuItem>
        ))}
      </MdMenu>
    </div>
  );
}

