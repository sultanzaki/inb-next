"use client";
import { Menu } from "@base-ui/react/menu";
import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";
import { useSyncExternalStore } from "react";
const subscribe = () => () => {};
export function ThemeControl({ compact = false }: { compact?: boolean }) {
  const { theme, setTheme } = useTheme();
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
  const options = [
    { key: "light", label: "Light", icon: Sun },
    { key: "dark", label: "Dark", icon: Moon },
    { key: "system", label: "System", icon: Monitor },
  ];
  if (compact)
    return (
      <div className="theme-control theme-control-compact">
        <span>Appearance</span>
        <Menu.RadioGroup
          aria-label="Appearance"
          value={mounted ? theme : undefined}
          onValueChange={setTheme}
        >
          {options.map(({ key, label, icon: Icon }) => (
            <Menu.RadioItem
              key={key}
              value={key}
              render={<button type="button" />}
              aria-label={`${label} theme`}
              closeOnClick={false}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </Menu.RadioItem>
          ))}
        </Menu.RadioGroup>
      </div>
    );
  return (
    <div
      className={"theme-control" + (compact ? " theme-control-compact" : "")}
    >
      <span>Appearance</span>
      <div role="group" aria-label="Appearance">
        {options.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            aria-label={`${label} theme`}
            title={label}
            aria-pressed={mounted && theme === key}
            onClick={() => setTheme(key)}
          >
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
