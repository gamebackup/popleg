/*
   Poptropica island sweep — run from the browser console.

   Open the game page first (local or deployed), then either paste this whole file
   into devtools, or from the same origin run:
       fetch('tools/pop-sweep.js').then(r => r.text()).then(eval)

   It loads each island in an offscreen iframe, one at a time, and waits until that
   frame actually requests its scene SWF. Keep the tab visible and in front: browsers
   throttle timers in background tabs and the run will crawl.

   The entry room comes from the client's own table (framework/data/config.xml). Most
   islands enter at "<Island>Main", but Early starts in City2, Shark in Mainstreet,
   Time in Present, Haunted in Haunted1 and LegendarySwords in Landing; Demo is not in
   the table at all and starts in LandPrototypeAS2. Asking those six for
   "scene<Island>Main.swf" is a 404 that says nothing about the island.

   A row that hits its deadline without asking for any scene is retried once, and its
   last few requests are printed: a throttled iframe looks exactly like a stall.

   At the end: a console table, plus window.__sweepResult (JSON, already copied to
   the clipboard if the page allows it).
*/
(async () => {
  const ISLANDS = ["Home","Early","Astro","Backlot","BigNate","Boardwalk","Carrot","Charlie",
    "Counter","Cryptid","Demo","GameShow","Ghost","Haunted","Japan","LegendarySwords","Moon",
    "Myth","Nabooti","NightWatch","Peanuts","Reality","Shark","Shipwreck","Shrink","Spy",
    "Steam","Super","Time","Trade","Train","Tribal","Vampire","Villain","West","Wimpy",
    "Woodland","Zombie"];

  // Used when config.xml cannot be read: the six islands whose entry is not
  // "<Island>Main" - five named by <islandMain>, plus Demo, which is not listed.
  const ENTRY_FALLBACK = {
    Early: "City2",
    Shark: "Mainstreet",
    Time: "Present",
    Haunted: "Haunted1",
    LegendarySwords: "Landing",
    Demo: "LandPrototypeAS2"
  };

  const PER_ISLAND_TIMEOUT = 30000;   // give up waiting for a scene after this
  const RETRY_TIMEOUT = 35000;        // one clean retry for a row that saw no scene
  const POLL = 250;                   // how often to look inside the frame
  const GAP = 500;                    // pause between islands

  const base = location.pathname.replace(/[^/]*$/, "");   // the game folder, with trailing slash
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rows = [];
  const startedAt = performance.now();

  const tagText = (el, tag) => {
    const node = el.getElementsByTagName(tag)[0];
    return node ? node.textContent.trim() : "";
  };

  async function entryRooms() {
    const out = Object.assign({}, ENTRY_FALLBACK);

    try {
      const res = await fetch("assets/framework/data/config.xml", { cache: "no-cache" });
      if (!res.ok) throw new Error(res.status + " config.xml");

      const xml = new DOMParser().parseFromString(await res.text(), "text/xml");
      Array.from(xml.getElementsByTagName("island")).forEach(el => {
        const name = tagText(el, "name"), main = tagText(el, "islandMain");

        // Only when the entry differs from what the client picks itself: "<Island>Main"
        // for ordinary islands, and the bare "<Island>" for Home (<islandMain>Home</islandMain>
        // is sceneHome.swf, which needs no room hint).
        if (name && main && main !== name + "Main" && main !== name) out[name] = main;
      });
    } catch (err) {
      console.warn("pop-sweep: island table unreadable, using fallbacks:", err.message || err);
    }

    return out;
  }

  async function probe(name, room, timeoutMs) {
    const frame = document.createElement("iframe");
    frame.style.cssText = "width:480px;height:360px;position:fixed;left:-9999px;top:0;border:0";
    document.body.appendChild(frame);

    const t0 = performance.now();
    frame.src = base + "base.html?island=" + encodeURIComponent(name) +
                (room ? "&room=" + encodeURIComponent(room) : "") +
                "&state=return_user_standard";

    let scene = "NONE", failed = [], reqs = 0, recent = [];
    const deadline = t0 + timeoutMs;

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
        failed = [...new Set(bad.map(e => e.responseStatus + " " + String(e.name).split("/").pop()))];

      // What the frame was doing when the deadline hit; reported for no-scene rows.
      recent = entries.slice(-6).map(e => String(e.name).split("/").pop() + " [" + (e.responseStatus || "?") + "]");

      const sc = entries.filter(e => /scenes\/island\w+\/scene\w+\.swf/i.test(e.name));
      if (sc.length) {
        scene = String(sc[0].name).split("/").pop() + " [" + sc[0].responseStatus + "]";
        break;
      }
    }

    frame.remove();
    await sleep(GAP);

    return { scene: scene, failed: failed, reqs: reqs, recent: recent, ms: Math.round(performance.now() - t0) };
  }

  const rooms = await entryRooms();

  console.log("%cpop-sweep: " + ISLANDS.length + " islands from " + base, "font-weight:bold");
  console.log("keep this tab focused until it finishes");

  for (const name of ISLANDS) {
    const room = rooms[name] || "";
    let r = await probe(name, room, PER_ISLAND_TIMEOUT);
    let retried = false;

    // A hidden iframe is throttled to a crawl and its resource list simply stops
    // growing - indistinguishable from a real stall without a second look.
    if (r.scene === "NONE" && !r.failed.length) {
      retried = true;

      const again = await probe(name, room, RETRY_TIMEOUT);
      r = { scene: again.scene, failed: again.failed, reqs: again.reqs, recent: again.recent, ms: r.ms + again.ms };
    }

    const row = {
      island: name,
      room: room,
      ms: r.ms,
      scene: r.scene,
      // Keep the array, not a display string: the summary counts failures with
      // failed.length, and "-" has a length of 1 (that bug reported ok:0 once).
      failed: r.failed,
      reqs: r.reqs,
      recent: r.recent
    };
    if (retried) row.retried = true;
    rows.push(row);

    console.log(
      String(rows.length).padStart(2) + "/" + ISLANDS.length + "  " +
      name.padEnd(16) + String(row.ms).padStart(6) + "ms  " +
      row.scene.padEnd(34) +
      (room ? "room:" + room + "  " : "") +
      (retried ? "retried  " : "") +
      (row.failed.length ? "FAIL" : "ok")
    );

    if (row.scene === "NONE" && row.recent.length)
      console.log("      stalled after: " + row.recent.join(", "));
  }

  const secs = ((performance.now() - startedAt) / 1000).toFixed(1);
  const summary = {
    finishedAt: new Date().toISOString(),
    tookSeconds: Number(secs),
    ok: rows.filter(r => !r.failed.length && r.scene !== "NONE").length,
    failed: rows.filter(r => r.failed.length).map(r => r.island),
    noScene: rows.filter(r => !r.failed.length && r.scene === "NONE").map(r => r.island),
    retried: rows.filter(r => r.retried).map(r => r.island),
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
