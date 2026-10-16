import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

const badgeVariants = cva(
  "group/badge inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1.5 overflow-hidden rounded-[var(--radius-chip)] border border-transparent px-2.5 py-1 text-[10px] font-medium whitespace-nowrap transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-primary/30 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default:
          "bg-primary-soft text-primary-dark before:content-[''] before:size-[5px] before:shrink-0 before:rounded-full before:bg-current [a]:hover:bg-primary-line/40",
        secondary:
          "bg-chip-bg text-muted before:content-[''] before:size-[5px] before:shrink-0 before:rounded-full before:bg-current [a]:hover:bg-chip-bg",
        destructive:
          "bg-danger-bg text-danger-dark before:content-[''] before:size-[5px] before:shrink-0 before:rounded-full before:bg-current focus-visible:ring-danger/20 [a]:hover:bg-danger/15",
        outline:
          "border-border bg-surface text-foreground [a]:hover:bg-surface-alt [a]:hover:text-muted",
        ghost:
          "hover:bg-surface-alt hover:text-muted",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant = "default",
  render,
  ...props
}: useRender.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(
      {
        className: cn(badgeVariants({ variant }), className),
      },
      props
    ),
    render,
    state: {
      slot: "badge",
      variant,
    },
  })
}

export { Badge, badgeVariants }
