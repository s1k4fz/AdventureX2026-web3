"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as SheetPrimitive } from "radix-ui"
import { motion } from "motion/react"

import { useUnitsMotion } from "@/lib/motion"
import { useDataStateOpen } from "@/lib/useDataStateOpen"
import { cn } from "@/lib/utils"

function Sheet({ ...props }: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />
}

function SheetTrigger({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />
}

function SheetClose({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />
}

function SheetPortal({
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Portal>) {
  return <SheetPrimitive.Portal data-slot="sheet-portal" {...props} />
}

function SheetOverlay({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Overlay>) {
  const [open, ref] = useDataStateOpen()
  const { snap } = useUnitsMotion()

  return (
    <SheetPrimitive.Overlay forceMount asChild {...props}>
      <motion.div
        ref={ref}
        data-slot="sheet-overlay"
        className={cn(
          "fixed inset-0 z-50 bg-[color-mix(in_srgb,var(--units-black)_40%,transparent)] data-[state=closed]:pointer-events-none data-[state=open]:pointer-events-auto",
          className
        )}
        initial={false}
        animate={{ opacity: open ? 1 : 0 }}
        transition={snap}
        style={{ pointerEvents: open ? "auto" : "none" }}
      />
    </SheetPrimitive.Overlay>
  )
}

const sideOffset = {
  right: { x: "100%", y: 0 },
  left: { x: "-100%", y: 0 },
  top: { x: 0, y: "-100%" },
  bottom: { x: 0, y: "100%" },
} as const

function SheetContent({
  className,
  children,
  side = "right",
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: "top" | "right" | "bottom" | "left"
  showCloseButton?: boolean
}) {
  const [open, ref] = useDataStateOpen()
  const { snap, reduce } = useUnitsMotion()
  const closed = sideOffset[side]

  return (
    <SheetPortal>
      <SheetOverlay />
      <SheetPrimitive.Content forceMount asChild {...props}>
        <motion.div
          ref={ref}
          data-slot="sheet-content"
          className={cn(
            "fixed z-50 flex flex-col gap-4 border-[var(--units-stroke-color)] bg-background shadow-none data-[state=closed]:pointer-events-none data-[state=open]:pointer-events-auto",
            side === "right" &&
              "inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
            side === "left" &&
              "inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
            side === "top" && "inset-x-0 top-0 h-auto border-b",
            side === "bottom" && "inset-x-0 bottom-0 h-auto border-t",
            className
          )}
          initial={false}
          animate={
            open
              ? { opacity: 1, x: 0, y: 0 }
              : {
                  opacity: reduce ? 0 : 1,
                  x: closed.x,
                  y: closed.y,
                }
          }
          transition={snap}
          style={{ pointerEvents: open ? "auto" : "none" }}
        >
          {children}
          {showCloseButton && (
            <SheetPrimitive.Close className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none data-[state=open]:bg-secondary">
              <XIcon className="size-4" />
              <span className="sr-only">Close</span>
            </SheetPrimitive.Close>
          )}
        </motion.div>
      </SheetPrimitive.Content>
    </SheetPortal>
  )
}

function SheetHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-header"
      className={cn("flex flex-col gap-1.5 p-4", className)}
      {...props}
    />
  )
}

function SheetFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="sheet-footer"
      className={cn("mt-auto flex flex-col gap-2 p-4", className)}
      {...props}
    />
  )
}

function SheetTitle({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("units-text-section text-foreground", className)}
      {...props}
    />
  )
}

function SheetDescription({
  className,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return (
    <SheetPrimitive.Description
      data-slot="sheet-description"
      className={cn("units-text-body-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Sheet,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
}
