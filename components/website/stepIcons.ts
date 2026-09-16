/**
 * The icons a process step may wear — one list, for the picker and the page.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * There were two lists and they disagreed.
 *
 * `ProcessStepEditor` offered thirteen icons. `ProcessBlock`'s registry knew
 * nine, four of them under lowercase aliases only, and three of those aliases
 * pointed deliberately at the WRONG icon:
 *
 *     phone: Mail,      // "Fallback to Mail icon for phone"
 *     heart: Sparkles,  // "Fallback to Sparkles for heart"
 *     star:  Sparkles,
 *
 * So an owner picking Phone published an envelope, Heart published sparkles,
 * and Target — absent from the registry entirely — fell through to the
 * emoji branch and published the literal word "Target" across the step's
 * heading. Four of thirteen choices rendered what was chosen.
 *
 * Both sides now read this. A picker option that nothing can draw, or a drawing
 * nothing can pick, is no longer expressible.
 *
 * @module components/website/stepIcons
 */

import {
  Calendar,
  CheckCircle,
  Clock,
  CreditCard,
  FileText,
  Heart,
  Mail,
  MessageCircle,
  Phone,
  Sparkles,
  Star,
  Target,
  Users,
  ClipboardCheck,
  Send,
  ArrowRight,
  type LucideIcon,
} from 'lucide-react';

export interface StepIconChoice {
  /** Stored on the step. PascalCase, matching the Lucide export name. */
  key: string;
  icon: LucideIcon;
  label: string;
}

/** What the picker offers, in the order it offers them. */
export const STEP_ICONS: StepIconChoice[] = [
  { key: 'CheckCircle', icon: CheckCircle, label: 'Check' },
  { key: 'Calendar', icon: Calendar, label: 'Calendar' },
  { key: 'CreditCard', icon: CreditCard, label: 'Payment' },
  { key: 'Users', icon: Users, label: 'Users' },
  { key: 'Heart', icon: Heart, label: 'Heart' },
  { key: 'Star', icon: Star, label: 'Star' },
  { key: 'Target', icon: Target, label: 'Target' },
  { key: 'Sparkles', icon: Sparkles, label: 'Sparkles' },
  { key: 'Clock', icon: Clock, label: 'Clock' },
  { key: 'FileText', icon: FileText, label: 'Form' },
  { key: 'Mail', icon: Mail, label: 'Email' },
  { key: 'Phone', icon: Phone, label: 'Phone' },
  { key: 'MessageCircle', icon: MessageCircle, label: 'Chat' },
];

/**
 * Names that never appear in the picker but do appear in stored data.
 *
 * Generated steps are written by a model and by older code paths, in whatever
 * case and vocabulary those used. They are aliases onto real icons — not
 * stand-ins for a different one.
 */
const LEGACY_ALIASES: Record<string, LucideIcon> = {
  ClipboardCheck,
  Send,
  ArrowRight,
  clipboard: ClipboardCheck,
  check: CheckCircle,
  user: Users,
  email: Mail,
  chat: MessageCircle,
  form: FileText,
  payment: CreditCard,
  time: Clock,
};

/**
 * Every name that resolves, keyed as stored and again in lower case.
 *
 * Lower case because generated content arrives that way, and a lookup that
 * cares about capitalisation is a lookup that silently fails.
 */
export const STEP_ICON_REGISTRY: Record<string, LucideIcon> = (() => {
  const registry: Record<string, LucideIcon> = { ...LEGACY_ALIASES };
  for (const [name, icon] of Object.entries(LEGACY_ALIASES)) {
    registry[name.toLowerCase()] = icon;
  }
  for (const choice of STEP_ICONS) {
    registry[choice.key] = choice.icon;
    registry[choice.key.toLowerCase()] = choice.icon;
  }
  return registry;
})();

/**
 * What a step wears when it names no icon, or names one we cannot draw.
 *
 * Taken from the list rather than imported separately, so it cannot become an
 * icon the picker does not offer.
 */
export const DEFAULT_STEP_ICON: LucideIcon = STEP_ICONS[0].icon;

/** The icon for a stored name, or null when the name is not one we draw. */
export function stepIconFor(name: string | undefined | null): LucideIcon | null {
  if (!name) return null;
  return STEP_ICON_REGISTRY[name] ?? STEP_ICON_REGISTRY[name.toLowerCase()] ?? null;
}
