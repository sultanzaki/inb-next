import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-[13.5px] font-medium whitespace-nowrap transition-colors duration-150 outline-none select-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-primary/30 active:not-aria-[haspopup]:translate-y-[0.5px] disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary-dark active:bg-primary-dark",
        outline:
          "border-border bg-surface hover:bg-surface-alt hover:text-foreground aria-expanded:bg-surface-alt aria-expanded:text-foreground",
        secondary:
          "border-border bg-surface text-secondary-foreground hover:bg-surface-alt aria-expanded:bg-surface-alt aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-surface-alt hover:text-foreground aria-expanded:bg-surface-alt aria-expanded:text-foreground",
        destructive:
          "bg-danger-bg text-danger-dark hover:bg-danger/15 focus-visible:border-danger/40 focus-visible:ring-danger/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-9 gap-1.5 px-3 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        xs: "h-6 gap-1 rounded-[var(--radius-chip)] px-2 text-xs in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-[30px] gap-1 rounded-md px-2.5 text-[13px] in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-1.5 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-9",
        "icon-xs":
          "size-6 rounded-[var(--radius-chip)] in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-[30px] rounded-md in-data-[slot=button-group]:rounded-md",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
