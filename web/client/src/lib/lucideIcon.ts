import { icons, Tag, type LucideIcon } from 'lucide-react';

const registry = icons as unknown as Record<string, LucideIcon>;

function pascalCase(name: string): string {
  return name
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1).toLowerCase())
    .join('');
}

/**
 * Resolves an icon name from `EXTRA_BUTTONS` against lucide's registry. The kebab-case name from
 * lucide.dev (`book-open`), the export name (`BookOpen`), and a lower-case word (`archive`) are all
 * accepted; a name that matches nothing falls back to a tag icon so a typo cannot break the toolbar.
 */
export function lucideIcon(name: string): LucideIcon {
  const trimmed = name.trim();
  return registry[trimmed] ?? registry[pascalCase(trimmed)] ?? registry[trimmed.charAt(0).toUpperCase() + trimmed.slice(1)] ?? Tag;
}
