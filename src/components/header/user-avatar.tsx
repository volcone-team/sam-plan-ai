import Image from "next/image";
import { User } from "lucide-react";
import { cn } from "@/lib/utils";

export interface UserAvatarProps {
  /** User's display name (for initials fallback and aria-label) */
  name?: string;
  /** Avatar image URL */
  imageUrl?: string;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeMap = {
  sm: "h-7 w-7 text-xs",
  md: "h-8 w-8 text-sm",
  lg: "h-10 w-10 text-base",
} as const;

/**
 * User avatar placeholder.
 * Shows initials or a generic user icon when no image is provided.
 * No authentication — purely presentational.
 */
export function UserAvatar({
  name,
  imageUrl,
  size = "md",
  className,
}: UserAvatarProps) {
  const initials = name
    ? name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
        .toUpperCase()
    : null;

  return (
    <div
      role="img"
      aria-label={name ? `${name}'s avatar` : "User avatar"}
      className={cn(
        "inline-flex items-center justify-center rounded-[var(--radius-full)]",
        "bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]",
        "font-medium shrink-0",
        sizeMap[size],
        className
      )}
    >
      {imageUrl ? (
        <Image
          src={imageUrl}
          alt={name || "User"}
          width={32}
          height={32}
          className="h-full w-full rounded-[var(--radius-full)] object-cover"
        />
      ) : initials ? (
        <span>{initials}</span>
      ) : (
        <User className="h-4 w-4" />
      )}
    </div>
  );
}
