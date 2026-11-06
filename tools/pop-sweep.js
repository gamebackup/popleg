/*
   Poptropica island sweep — run from the browser console.

   Open the game page first (local or deployed), then either paste this whole file
   into devtools, or from the same origin run:
       fetch('../../tools/pop-sweep.js').then(r => r.text()).then(eval)

   It loads each island in an offscreen iframe, one at a time, and waits until that
   frame actually requests its scene SWF. Keep the tab visible and in front: browsers
   throttle timers in background tabs and the run will crawl.

   At the end: a console table, plus window.__sweepResult (JSON, already copied to
   the clipboard if the page allows it).
*/
(async () => {
  const ISLANDS = ["Home","Early","Astro","Backlot","BigNate","Boardwalk","Carrot","Charlie",
    "Counter","Cryptid","Demo","GameShow","Ghost","Haunted","Japan","LegendarySwords","Moon",
    "Myth","Nabooti","NightWatch","Peanuts","Reality","Shark","Shipwreck","Shrink","Spy",
    "Steam","Super","Time","Trade","Train","Tribal","Vampire","Villain","West","Wimpy",
    "Woodland","Zombie"];

  const PER_ISLAND_TIMEOUT = 30000;   // give up waiting for a scene after this
  const POLL = 250;                   // how often to look inside the frame
  const GAP = 500;                    // pause between islands

  const base = location.pathname.replace(/[^/]*$/, "");   // the game folder, with trailing slash
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rows = [];
  const startedAt = performance.now();

  console.log("%cpop-sweep: " + ISLANDS.length + " islands from " + base, "font-weight:bold");
  console.log("keep this tab focused until it finishes");

  for (const name of ISLANDS) {
    const frame = document.createElement("iframe");
    frame.style.cssText = "width:480px;height:360px;position:fixed;left:-9999px;top:0;border:0";
    document.body.appendChild(frame);

    const t0 = performance.now();
    frame.src = base + "base.html?island=" + encodeURIComponent(name) + "&state=return_user_standard";

    let scene = "NONE", failed = [], reqs = 0;
    const deadline = t0 + PER_ISLAND_TIMEOUT;

    while (performance.now() < deadline) {
      await sleep(POLL);
      let entries;
      try {
        const w = frame.contentWindow;
        if (!w || !w.performance) continue;
        entries = w.performance.getEntriesByType("resource");
      } catch (err) {
        continue;                       // frame mid-navigation
      }
      reqs = entries.length;

      const bad = entries.filter(e => e.responseStatus >= 400);
      if (bad.length)
        failed = bad.map(e => e.responseStatus + " " + String(e.name).split("/").pop());

      const sc = entries.filter(e => /scenes\/island\w+\/scene\w+\.swf/i.test(e.name));
      if (sc.length) {
        scene = String(sc[0].name).split("/").pop() + " [" + sc[0].responseStatus + "]";
        break;
      }
    }

    const row = {
      island: name,
      ms: Math.round(performance.now() - t0),
      scene: scene,
      // Keep the array, not a display string: the summary counts failures with
      // failed.length, and "-" has a length of 1 (that bug reported ok:0 once).
      failed: failed,
      reqs: reqs
    };
    rows.push(row);

    console.log(
      String(rows.length).padStart(2) + "/" + ISLANDS.length + "  " +
      name.padEnd(16) + String(row.ms).padStart(6) + "ms  " +
      row.scene.padEnd(34) + (failed.length ? "FAIL" : "ok")
    );

    frame.remove();
    await sleep(GAP);
  }

  const secs = ((performance.now() - startedAt) / 1000).toFixed(1);
  const summary = {
    finishedAt: new Date().toISOString(),
    tookSeconds: Number(secs),
    ok: rows.filter(r => !r.failed.length && r.scene !== "NONE").length,
    failed: rows.filter(r => r.failed.length).map(r => r.island),
    noScene: rows.filter(r => !r.failed.length && r.scene === "NONE").map(r => r.island),
    rows: rows
  };

  window.__sweepResult = summary;

  console.log("%c=== done in " + secs + "s · ok " + summary.ok + " · failed " +
              summary.failed.length + " · no scene " + summary.noScene.length + " ===",
              "font-weight:bold");
  if (console.table) console.table(rows);

  const text = JSON.stringify(summary);
  console.log("---- copy this line and paste it back ----");
  console.log(text);
  try { await navigator.clipboard.writeText(text); console.log("(also copied to your clipboard)"); } catch (err) {}

  return summary;
})();
