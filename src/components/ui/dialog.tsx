"use client"

import * as React from "react"
import { XIcon } from "lucide-react"
import { Dialog as DialogPrimitive } from "radix-ui"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"

function Dialog({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />
}

function DialogPortal({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
        className
      )}
      {...props}
    />
  )
}

/** Below this width dialogs are bottom sheets (see index.css). */
const SHEET_MAX_WIDTH = 640
/** Height of the grab zone at the top of a sheet. */
const SHEET_HANDLE = 56

/**
 * Touch handlers that let a bottom sheet be dragged down by its top edge and
 * dismissed, like native sheets. `close` runs once the sheet has slid away.
 */
function useSheetDrag(close: () => void) {
  const drag = React.useRef<{ startY: number; startedAt: number; distance: number } | null>(null)

  const settle = (element: HTMLElement, dismiss: boolean) => {
    element.style.transition = "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)"
    if (!dismiss) {
      element.style.transform = ""
      return
    }
    element.style.transform = "translate3d(0, 100%, 0)"
    // It has already slid off screen: skip the closing animation.
    element.style.animation = "none"
    window.setTimeout(close, 200)
  }

  return {
    onTouchStart(event: React.TouchEvent<HTMLDivElement>) {
      if (window.innerWidth >= SHEET_MAX_WIDTH || event.touches.length !== 1) return
      const element = event.currentTarget
      const touch = event.touches[0]
      if (touch.clientY - element.getBoundingClientRect().top > SHEET_HANDLE) return
      if (event.target instanceof Element && event.target.closest("button, a, input, textarea, select, [role='tab']")) return
      drag.current = { startY: touch.clientY, startedAt: event.timeStamp, distance: 0 }
      element.style.transition = "none"
    },
    onTouchMove(event: React.TouchEvent<HTMLDivElement>) {
      const state = drag.current
      if (!state) return
      state.distance = Math.max(0, event.touches[0].clientY - state.startY)
      event.currentTarget.style.transform = `translate3d(0, ${state.distance}px, 0)`
    },
    onTouchEnd(event: React.TouchEvent<HTMLDivElement>) {
      const state = drag.current
      drag.current = null
      if (!state) return
      const speed = state.distance / Math.max(1, event.timeStamp - state.startedAt)
      settle(event.currentTarget, state.distance > 120 || (state.distance > 40 && speed > 0.6))
    },
    onTouchCancel(event: React.TouchEvent<HTMLDivElement>) {
      if (!drag.current) return
      drag.current = null
      settle(event.currentTarget, false)
    },
  }
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
}) {
  const closeRef = React.useRef<HTMLButtonElement>(null)
  const sheetDrag = useSheetDrag(() => closeRef.current?.click())

  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        {...sheetDrag}
        data-slot="dialog-content"
        className={cn(
          "fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border bg-background p-6 shadow-lg duration-200 outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 sm:max-w-lg",
          className
        )}
        {...props}
      >
        {children}
        {/* Lets the drag-to-dismiss gesture close the dialog the same way the button does. */}
        <DialogPrimitive.Close ref={closeRef} tabIndex={-1} aria-hidden="true" className="hidden" />
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:bg-foreground/15 focus-visible:text-foreground disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  showCloseButton?: boolean
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
