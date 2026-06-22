// cn — clsx + tailwind-merge. Use for all conditional/merged Tailwind class lists
// so later classes reliably override earlier ones (no CSS-order surprises).
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
