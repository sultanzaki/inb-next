"use client";
import {
  Children,
  cloneElement,
  isValidElement,
  type ReactElement,
  type ReactNode,
  type MouseEventHandler,
} from "react";
import { MoreHorizontal } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { CopyValue } from "./data-tools";

type ActionProps = {
  children?: ReactNode;
  title?: string;
  "aria-label"?: string;
  "aria-busy"?: boolean;
  "data-tone"?: string;
  onClick?: MouseEventHandler<HTMLElement>;
  disabled?: boolean;
  href?: string;
  target?: string;
  rel?: string;
  menuItem?: boolean;
};
export function RowActions({
  children,
  label = "Row actions",
}: {
  children: ReactNode;
  label?: string;
}) {
  const actions = Children.toArray(children).filter(
    isValidElement,
  ) as ReactElement<ActionProps>[];
  if (!actions.length) return null;
  return (
    <div className="row-actions">
      <div className="row-actions-desktop">{children}</div>
      <div className="row-actions-mobile">
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <button type="button" className="row-action" aria-label={label} />
            }
          >
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-44">
            {actions.map((action, index) => {
              if (action.type === CopyValue)
                return cloneElement(action, { key: index, menuItem: true });
              const p = action.props;
              return (
                <DropdownMenuItem
                  key={index}
                  variant={
                    p["data-tone"] === "danger" ? "destructive" : "default"
                  }
                  disabled={p.disabled}
                  aria-busy={p["aria-busy"]}
                  onClick={p.onClick}
                  {...(p.href
                    ? {
                        render: (
                          <a href={p.href} target={p.target} rel={p.rel} />
                        ),
                      }
                    : {})}
                >
                  {p.children}
                  <span>{p["aria-label"] || p.title || "Open"}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
