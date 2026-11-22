/**
 * Splits one file into an ordered list of print runs, each all colour or all B&W
 * (same rules as the desktop app, partner-desktop/src/print/colourRuns.js).
 *
 * - Single-sided: consecutive pages with the same colour form one run.
 * - Double-sided: the unit is a sheet (pages 1-2, 3-4, ...). A sheet with a colour page
 *   on either side prints in colour, so a run never starts on the back of a sheet.
 * - Copies: a one-run file prints as one job with `copies`. A file with several runs
 *   repeats the whole sequence once per copy (each run once), so the stacks come out collated.
 *
 * Pages are 1-based, as the server sends them.
 */
export type Run = { pages: number[]; colour: 'color' | 'bw'; copies: number };

export function planRuns(input: { pageCount: number; colour: 'color' | 'bw' | 'mixed'; colorPages?: number[]; duplex: boolean; copies: number }): Run[] {
  const total = Math.max(1, Math.floor(input.pageCount) || 1);
  const count = Math.max(1, Math.floor(input.copies) || 1);
  const all = Array.from({ length: total }, (_, i) => i + 1);
  if (input.colour !== 'mixed') return [{ pages: all, colour: input.colour === 'color' ? 'color' : 'bw', copies: count }];
  const inColour = new Set((input.colorPages ?? []).filter((p) => Number.isInteger(p) && p >= 1 && p <= total));
  if (inColour.size === 0) return [{ pages: all, colour: 'bw', copies: count }];
  if (inColour.size === total) return [{ pages: all, colour: 'color', copies: count }];
  const size = input.duplex ? 2 : 1;
  const runs: { pages: number[]; colour: 'color' | 'bw' }[] = [];
  for (let start = 1; start <= total; start += size) {
    const pages = all.slice(start - 1, start - 1 + size);
    const colour = pages.some((p) => inColour.has(p)) ? 'color' : 'bw';
    const last = runs[runs.length - 1];
    if (last && last.colour === colour) last.pages.push(...pages);
    else runs.push({ pages, colour });
  }
  if (runs.length === 1) return [{ ...runs[0], copies: count }];
  const sequence: Run[] = [];
  for (let c = 0; c < count; c++) for (const r of runs) sequence.push({ pages: [...r.pages], colour: r.colour, copies: 1 });
  return sequence;
}

/** True when the run is the whole document, so the file can be sent as it is. */
export function isWholeFile(run: Run, pageCount: number) {
  return run.pages.length === pageCount && run.pages.every((p, i) => p === i + 1);
}
