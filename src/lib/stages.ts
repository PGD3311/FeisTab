/** Name for the next stage: one more than the highest "Stage <number>", or count + 1. */
export function nextStageName(names: string[]): string {
  let highest = 0;
  for (const name of names) {
    const match = /^Stage (\d+)$/.exec(name.trim());
    if (match) highest = Math.max(highest, Number(match[1]));
  }
  return `Stage ${highest > 0 ? highest + 1 : names.length + 1}`;
}
