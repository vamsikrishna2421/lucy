/**
 * Local Indian-food portion DB (Vamsi #2 health UX) — PURE, offline, instant. Common Indian home foods
 * with per-portion (katori / piece / cup / glass / plate) calories + macros, so logging "2 rotis and a
 * katori of dal" resolves WITHOUT an LLM round-trip (fast + consistent + works offline). Novel meals
 * still fall back to the LLM estimator. Numbers are realistic approximations (guidance, not clinical) —
 * portions follow Indian eating patterns per docs/INDIA_HEALTH_RESEARCH.md.
 */
export interface FoodPortion { display: string; unit: string; cal: number; p: number; c: number; f: number; aliases: string[] }

// per ONE of `unit`. Aliases are matched as whole words; the LONGEST alias wins ("masala dosa" > "dosa").
export const FOOD_DB: FoodPortion[] = [
  // Staples
  { display: 'Roti', unit: 'piece', cal: 80, p: 3, c: 15, f: 2, aliases: ['roti', 'rotis', 'chapati', 'chapatis', 'chapathi', 'phulka', 'phulkas'] },
  { display: 'Paratha', unit: 'piece', cal: 150, p: 3, c: 20, f: 7, aliases: ['paratha', 'parathas', 'parantha', 'paronthi'] },
  { display: 'Aloo paratha', unit: 'piece', cal: 210, p: 5, c: 28, f: 9, aliases: ['aloo paratha', 'alu paratha', 'potato paratha'] },
  { display: 'Naan', unit: 'piece', cal: 260, p: 8, c: 45, f: 5, aliases: ['naan', 'butter naan', 'garlic naan'] },
  { display: 'Rice', unit: 'katori', cal: 200, p: 4, c: 44, f: 1, aliases: ['rice', 'chawal', 'steamed rice', 'white rice', 'plain rice', 'boiled rice'] },
  { display: 'Bread', unit: 'slice', cal: 70, p: 2, c: 13, f: 1, aliases: ['bread', 'toast', 'bread slice'] },
  // Dals & curries
  { display: 'Dal', unit: 'katori', cal: 140, p: 9, c: 20, f: 4, aliases: ['dal', 'daal', 'dhal', 'lentils', 'toor dal', 'moong dal', 'masoor dal', 'dal fry'] },
  { display: 'Dal makhani', unit: 'katori', cal: 290, p: 11, c: 28, f: 14, aliases: ['dal makhani', 'daal makhani', 'makhani'] },
  { display: 'Rajma', unit: 'katori', cal: 210, p: 10, c: 30, f: 5, aliases: ['rajma', 'kidney beans', 'rajma masala'] },
  { display: 'Chole', unit: 'katori', cal: 230, p: 11, c: 30, f: 8, aliases: ['chole', 'chana masala', 'chana', 'chickpea curry', 'chhole'] },
  { display: 'Sabzi', unit: 'katori', cal: 120, p: 3, c: 12, f: 7, aliases: ['sabzi', 'sabji', 'subzi', 'vegetable curry', 'mixed veg', 'bhaji'] },
  { display: 'Aloo gobi', unit: 'katori', cal: 150, p: 3, c: 15, f: 9, aliases: ['aloo gobi', 'alu gobi'] },
  { display: 'Bhindi', unit: 'katori', cal: 130, p: 3, c: 12, f: 8, aliases: ['bhindi', 'okra', 'lady finger'] },
  { display: 'Paneer curry', unit: 'katori', cal: 270, p: 12, c: 10, f: 20, aliases: ['paneer', 'paneer curry', 'paneer masala', 'shahi paneer', 'kadai paneer', 'matar paneer'] },
  { display: 'Palak paneer', unit: 'katori', cal: 250, p: 12, c: 10, f: 18, aliases: ['palak paneer', 'saag paneer'] },
  { display: 'Chicken curry', unit: 'katori', cal: 250, p: 22, c: 6, f: 15, aliases: ['chicken curry', 'chicken masala', 'butter chicken', 'chicken gravy'] },
  { display: 'Fish curry', unit: 'katori', cal: 220, p: 20, c: 6, f: 12, aliases: ['fish curry', 'fish masala'] },
  { display: 'Egg curry', unit: 'katori', cal: 200, p: 12, c: 8, f: 13, aliases: ['egg curry', 'anda curry'] },
  { display: 'Sambar', unit: 'katori', cal: 110, p: 5, c: 14, f: 3, aliases: ['sambar', 'sambhar'] },
  // South Indian
  { display: 'Idli', unit: 'piece', cal: 55, p: 2, c: 12, f: 1, aliases: ['idli', 'idlis', 'idly'] },
  { display: 'Masala dosa', unit: 'piece', cal: 250, p: 5, c: 35, f: 10, aliases: ['masala dosa'] },
  { display: 'Dosa', unit: 'piece', cal: 130, p: 3, c: 20, f: 4, aliases: ['dosa', 'dosas', 'plain dosa', 'dose'] },
  { display: 'Vada', unit: 'piece', cal: 130, p: 4, c: 14, f: 7, aliases: ['vada', 'vadas', 'medu vada', 'wada'] },
  { display: 'Uttapam', unit: 'piece', cal: 180, p: 5, c: 28, f: 5, aliases: ['uttapam', 'uthappam'] },
  { display: 'Upma', unit: 'katori', cal: 200, p: 5, c: 30, f: 7, aliases: ['upma', 'uppma'] },
  { display: 'Poha', unit: 'katori', cal: 180, p: 4, c: 30, f: 5, aliases: ['poha', 'pohe'] },
  { display: 'Curd rice', unit: 'katori', cal: 200, p: 5, c: 30, f: 6, aliases: ['curd rice', 'dahi rice', 'thayir sadam'] },
  // Rice mains
  { display: 'Veg biryani', unit: 'plate', cal: 350, p: 9, c: 50, f: 12, aliases: ['veg biryani', 'vegetable biryani', 'biryani', 'biriyani', 'pulao', 'pulav', 'fried rice'] },
  { display: 'Chicken biryani', unit: 'plate', cal: 450, p: 22, c: 50, f: 16, aliases: ['chicken biryani', 'mutton biryani', 'egg biryani', 'non veg biryani'] },
  { display: 'Khichdi', unit: 'katori', cal: 200, p: 7, c: 32, f: 4, aliases: ['khichdi', 'khichdi', 'kichdi'] },
  { display: 'Pav bhaji', unit: 'plate', cal: 400, p: 9, c: 50, f: 18, aliases: ['pav bhaji', 'pao bhaji'] },
  { display: 'Maggi', unit: 'pack', cal: 350, p: 7, c: 50, f: 13, aliases: ['maggi', 'instant noodles', 'noodles'] },
  // Dairy / drinks
  { display: 'Curd', unit: 'katori', cal: 90, p: 5, c: 6, f: 5, aliases: ['curd', 'dahi', 'yogurt', 'yoghurt'] },
  { display: 'Raita', unit: 'katori', cal: 100, p: 4, c: 8, f: 5, aliases: ['raita'] },
  { display: 'Chai', unit: 'cup', cal: 90, p: 2, c: 12, f: 3, aliases: ['chai', 'tea', 'milk tea', 'masala chai'] },
  { display: 'Coffee', unit: 'cup', cal: 80, p: 2, c: 10, f: 3, aliases: ['coffee', 'filter coffee'] },
  { display: 'Milk', unit: 'glass', cal: 150, p: 8, c: 12, f: 8, aliases: ['milk', 'doodh'] },
  { display: 'Lassi', unit: 'glass', cal: 220, p: 6, c: 30, f: 8, aliases: ['lassi', 'sweet lassi'] },
  { display: 'Buttermilk', unit: 'glass', cal: 60, p: 3, c: 5, f: 2, aliases: ['buttermilk', 'chaas', 'chhaas', 'majjiga'] },
  // Eggs / protein
  { display: 'Egg', unit: 'piece', cal: 78, p: 6, c: 1, f: 5, aliases: ['egg', 'eggs', 'boiled egg', 'anda'] },
  { display: 'Omelette', unit: 'piece', cal: 160, p: 11, c: 2, f: 12, aliases: ['omelette', 'omelet', 'egg bhurji', 'bhurji'] },
  // Snacks / sweets / fruit
  { display: 'Samosa', unit: 'piece', cal: 260, p: 4, c: 30, f: 14, aliases: ['samosa', 'samosas'] },
  { display: 'Pakora', unit: 'plate', cal: 300, p: 6, c: 25, f: 20, aliases: ['pakora', 'pakoda', 'bhajji', 'fritters'] },
  { display: 'Vada pav', unit: 'piece', cal: 290, p: 7, c: 40, f: 11, aliases: ['vada pav', 'vada pao'] },
  { display: 'Gulab jamun', unit: 'piece', cal: 150, p: 2, c: 25, f: 5, aliases: ['gulab jamun', 'gulab jamuns'] },
  { display: 'Jalebi', unit: 'piece', cal: 150, p: 1, c: 25, f: 5, aliases: ['jalebi', 'jalebis'] },
  { display: 'Banana', unit: 'piece', cal: 105, p: 1, c: 27, f: 0, aliases: ['banana', 'bananas', 'kela'] },
  { display: 'Apple', unit: 'piece', cal: 95, p: 0, c: 25, f: 0, aliases: ['apple', 'apples'] },
  { display: 'Almonds', unit: 'handful', cal: 70, p: 3, c: 3, f: 6, aliases: ['almonds', 'badam'] },
  { display: 'Salad', unit: 'katori', cal: 50, p: 2, c: 8, f: 1, aliases: ['salad', 'green salad'] },
];

const NUM_WORDS: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, couple: 2, half: 0.5 };
const FILLER = new Set(['had', 'have', 'ate', 'eat', 'some', 'the', 'and', 'for', 'with', 'today', 'lunch', 'breakfast', 'dinner', 'snack', 'morning', 'evening', 'night', 'just', 'only', 'also', 'then', 'plus', 'my', 'of', 'cup', 'glass', 'plate', 'bowl', 'katori', 'piece', 'pieces', 'pcs', 'small', 'big', 'large']);

function norm(s: string): string { return (s || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim(); }

/** Parse a quantity from a fragment ("2 rotis", "x3", "a katori", "couple of idlis"). Defaults to 1. */
export function parseQty(fragment: string): number {
  const f = fragment.toLowerCase();
  const xm = /(?:x|×|\*)\s*(\d+(?:\.\d+)?)/.exec(f); if (xm) return parseFloat(xm[1]);
  const dm = /(\d+(?:\.\d+)?)/.exec(f); if (dm) return parseFloat(dm[1]);
  for (const [w, n] of Object.entries(NUM_WORDS)) if (new RegExp(`\\b${w}\\b`).test(f)) return n;
  return 1;
}

/** Longest-alias match of a fragment against the DB, or null. */
export function matchFood(fragment: string): FoodPortion | null {
  const f = ` ${norm(fragment)} `;
  let best: FoodPortion | null = null; let bestLen = 0;
  for (const entry of FOOD_DB) {
    for (const a of entry.aliases) {
      if (f.includes(` ${a} `) && a.length > bestLen) { best = entry; bestLen = a.length; }
    }
  }
  return best;
}

export interface DbFoodItem { name: string; qty: number; unit: string; calories: number; protein_g: number; carbs_g: number; fat_g: number; confidence: 'medium' }

/** Resolve a whole meal against the local DB. Returns matched items + fragments it couldn't resolve
 *  (real unknown foods, not filler words). A caller uses unresolved.length to decide DB vs LLM. */
export function lookupMeal(text: string): { items: DbFoodItem[]; unresolved: string[] } {
  const frags = (text || '').split(/\s*(?:,|;|\band\b|\bwith\b|\bplus\b|\+|&)\s*/i).map((s) => s.trim()).filter(Boolean);
  const items: DbFoodItem[] = [];
  const unresolved: string[] = [];
  for (const frag of frags) {
    const entry = matchFood(frag);
    if (entry) {
      const qty = parseQty(frag);
      items.push({
        name: entry.display, qty, unit: entry.unit,
        calories: Math.round(qty * entry.cal), protein_g: Math.round(qty * entry.p),
        carbs_g: Math.round(qty * entry.c), fat_g: Math.round(qty * entry.f), confidence: 'medium',
      });
    } else {
      // Unresolved only if the fragment names something foodish (a real word that isn't filler/number).
      const words = norm(frag).split(' ').filter((w) => w.length >= 3 && !FILLER.has(w) && !/^\d+$/.test(w));
      if (words.length > 0) unresolved.push(frag.trim());
    }
  }
  return { items, unresolved };
}
