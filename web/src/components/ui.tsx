import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";

export function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "icon";
}) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-semibold transition-all duration-300 ease-smooth disabled:pointer-events-none disabled:opacity-50",
        variant === "default" &&
          "bg-primary text-primary-foreground shadow-glow hover:bg-primary/90 hover:-translate-y-0.5",
        variant === "outline" && "border border-border bg-card hover:bg-secondary",
        variant === "ghost" && "hover:bg-secondary",
        size === "default" && "h-11 px-6",
        size === "sm" && "h-9 px-4",
        size === "icon" && "h-11 w-11",
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "flex h-11 w-full rounded-full border border-input bg-card px-4 text-sm outline-none ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("glass-card p-6", className)}>{children}</div>;
}
