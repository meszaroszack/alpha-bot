import { cn } from "@/lib/utils";
import * as React from "react";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-[#1E1E2E] bg-[#12121A] px-3 py-1 text-sm text-[#E8E8F0] shadow-sm transition-colors placeholder:text-[#6B6B8A] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#00D4AA]/40 disabled:cursor-not-allowed disabled:opacity-50",
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Input.displayName = "Input";

export { Input };
