import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

/**
 * Merges Tailwind CSS class names safely.
 * Combines clsx (conditional classes) with tailwind-merge (deduplication).
 * Used by all shadcn components via cn("base-class", conditionalClass && "extra").
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
