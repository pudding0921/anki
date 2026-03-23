"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  isOpen: boolean;
  itemName: string;
  itemType: "deck" | "folder" | "card";
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  isOpen,
  itemName,
  itemType,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const [step, setStep] = useState<1 | 2>(1);

  // Reset to step 1 whenever dialog opens
  useEffect(() => {
    if (isOpen) setStep(1);
  }, [isOpen]);

  if (!isOpen) return null;

  function handleFirstConfirm() {
    setStep(2);
  }

  function handleFinalConfirm() {
    onConfirm();
  }

  function handleCancel() {
    onCancel();
  }

  const label = itemType.charAt(0).toUpperCase() + itemType.slice(1);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={handleCancel}
    >
      <div
        className="bg-card border border-border rounded-2xl p-6 w-full max-w-sm shadow-2xl flex flex-col gap-5 mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        {step === 1 ? (
          <>
            <div className="flex flex-col gap-2">
              <h2 className="font-semibold text-base">Delete {label}?</h2>
              <p className="text-sm text-muted-foreground">
                Are you sure you want to delete{" "}
                <span className="font-medium text-foreground">
                  &ldquo;{itemName}&rdquo;
                </span>
                ?
              </p>
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={handleFirstConfirm}>
                Delete
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="flex flex-col gap-2">
              <h2 className="font-semibold text-base">Are you really sure?</h2>
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  &ldquo;{itemName}&rdquo;
                </span>{" "}
                will be moved to Trash. You can restore it within 30 days.
              </p>
            </div>
            <div className="flex gap-3 justify-end">
              <Button variant="outline" size="sm" onClick={handleCancel}>
                Cancel
              </Button>
              <Button variant="destructive" size="sm" onClick={handleFinalConfirm}>
                Yes, Move to Trash
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
