// Client-safe labels for trip styles (the "filters" on the Plan page).
import type { TripStyle } from "./types";

export const STYLE_META: Record<TripStyle, { emoji: string; label: string }> = {
  cinematic: { emoji: "🎬", label: "Cinematic" },
  cultural: { emoji: "🏛️", label: "Cultural" },
  adventure: { emoji: "🧗", label: "Adventure" },
  luxury: { emoji: "💎", label: "Luxury" },
  relaxation: { emoji: "🌴", label: "Relaxed" },
  foodie: { emoji: "🍜", label: "Foodie" },
  nightlife: { emoji: "🍸", label: "Nightlife" },
  romantic: { emoji: "💞", label: "Romantic" },
};

/** ["foodie"] -> "Foodie day"; ["adventure","cinematic"] -> "Adventure + Cinematic day". */
export function vibeLabel(vibe: TripStyle[]): string {
  return `${vibe.map((s) => STYLE_META[s].label).join(" + ")} day`;
}
