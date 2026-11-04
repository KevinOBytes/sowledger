"use client";

import { useEffect, useRef, type ReactNode, type RefObject } from "react";

type ModalDialogProps = {
  children: ReactNode;
  onClose: () => void;
  className: string;
  id?: string;
  label?: string;
  labelledBy?: string;
  initialFocusRef?: RefObject<HTMLElement | null>;
  returnFocusRef?: RefObject<HTMLElement | null>;
  dismissOnBackdrop?: boolean;
};

/** Mount only while open. Native modal behavior keeps the rest of the page inert. */
export function ModalDialog({ children, onClose, className, id, label, labelledBy, initialFocusRef, returnFocusRef, dismissOnBackdrop = false }: ModalDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    // Safari does not focus buttons on pointer activation, so callers can identify the opener.
    const previousFocus = returnFocusRef?.current ?? document.activeElement;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    initialFocusRef?.current?.focus();

    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, [initialFocusRef, returnFocusRef]);

  return (
    <dialog
      ref={dialogRef}
      id={id}
      aria-modal="true"
      aria-label={label}
      aria-labelledby={labelledBy}
      className={`fixed flex flex-col overflow-hidden p-0 [&:not([open])]:hidden ${className}`}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Tab") return;
        const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'))
          .filter((element) => !element.matches(":disabled") && element.tabIndex >= 0 && element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (!first) {
          event.preventDefault();
          event.currentTarget.focus();
        } else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onClick={(event) => {
        if (!dismissOnBackdrop || event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
    >
      {children}
    </dialog>
  );
}
