// Mom's page keeps each state machine's last 20 events in a development build (web/src/lib/machine.ts). When a check
// fails, these scripts print them, so the report shows the events that led to a stuck screen.

/** Prints each page's machine history. A page without one (the kid's pages, a production build) prints nothing. */
export async function printMachineHistory(pages) {
  for (const page of pages) {
    if (!page || page.isClosed()) continue;
    const h = await page.evaluate(() => window.__homecookdMachines?.() ?? null).catch(() => null);
    if (!h || !Object.keys(h).length) continue;
    console.log(`  last events on ${new URL(page.url()).pathname}:`);
    for (const [name, steps] of Object.entries(h)) {
      for (const s of steps) console.log(`    ${name}  ${s.from} --${s.event}--> ${s.to ?? '(ignored)'}  ${s.t} ms`);
    }
  }
}
