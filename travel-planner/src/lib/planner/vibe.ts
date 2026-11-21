// What kind of day is this? Scored in code from the day's actual stops (no AI), so it always
// matches the plan, updates after every edit, and uses your own trip styles when they fit.
import { findRef, TRIP_STYLES, type Dataset, type PlanDay, type TripStyle } from "./types";

type Scores = Record<TripStyle, number>;

const has = (text: string, re: RegExp) => re.test(text.toLowerCase());

export function dayVibeScores(day: PlanDay, ds: Dataset): Scores {
  const s = Object.fromEntries(TRIP_STYLES.map((t) => [t, 0])) as Scores;
  let count = 0;
  for (const b of day.blocks)
    for (const it of b.items) {
      const r = findRef(ds, it.ref);
      if (r?.kind !== "place") continue;
      count++;
      const p = r.item;
      const text = `${p.name} ${p.types.join(" ")}`;
      const pricey = p.price.level === 4 || ((p.price.level ?? 0) >= 3 && p.category === "food") || (p.price.maxUsd ?? 0) >= 100;
      switch (p.category) {
        case "photo":
          s.cinematic += 2;
          if (b.slot === "evening") s.romantic += 1;
          break;
        case "culture":
          s.cultural += 2;
          break;
        case "sights":
          if (has(text, /castle|monaster|histor|landmark|church|cathedral|museum|palace|fort|ruin|temple|old town/)) s.cultural += 1;
          if (has(text, /view|mirador|miradouro|lookout|scenic|bridge|tower|skyline|overlook/)) s.cinematic += 1;
          if (!has(text, /castle|monaster|histor|landmark|church|cathedral|museum|palace|fort|ruin|temple|view|mirador|miradouro|lookout|scenic|bridge|tower/)) s.cultural += 1;
          break;
        case "outdoors":
          if (has(text, /hike|trail|kayak|surf|climb|zip|dive|snorkel|bike|rainforest|volcano|canyon|cave/)) s.adventure += 2;
          else if (has(text, /beach|park|garden|spa|pool|lake|bay/)) s.relaxation += 2;
          else {
            s.adventure += 1;
            s.relaxation += 1;
          }
          break;
        case "tours":
          if (has(text, /food|wine|tasting|culinary|rum|beer|coffee/)) s.foodie += 2;
          else if (has(text, /sail|boat|sunset|cruise/)) {
            s.cinematic += 1;
            s.romantic += 1;
          } else s.adventure += 2;
          break;
        case "food":
          s.foodie += 1.5;
          if (b.slot === "evening" && pricey) s.romantic += 1;
          break;
        case "nightlife":
          s.nightlife += 2;
          break;
        case "events":
          if (has(text, /jazz|music|concert|dj|club|party|live/)) s.nightlife += 2;
          else if (has(text, /food|wine|taste/)) s.foodie += 2;
          else s.cultural += 2;
          break;
      }
      if (pricey) s.luxury += 1.5;
    }
  if (count > 0 && count <= 2) s.relaxation += 1; // a light day
  return s;
}

/** Up to two styles that describe the day, preferring the trip's own styles. [] for an empty day. */
export function dayVibe(day: PlanDay, ds: Dataset, tripStyles: TripStyle[]): TripStyle[] {
  const scores = dayVibeScores(day, ds);
  const ranked = (TRIP_STYLES as readonly TripStyle[]).filter((t) => scores[t] >= 1.5).sort((a, b) => scores[b] - scores[a]);
  if (!ranked.length) return [];
  const mine = ranked.filter((t) => tripStyles.includes(t));
  const pick = (mine.length ? mine : ranked).slice(0, 2);
  // Only show a second style when it's a real part of the day (at least half the top score).
  return pick.length === 2 && scores[pick[1]] < scores[pick[0]] / 2 ? pick.slice(0, 1) : pick;
}
