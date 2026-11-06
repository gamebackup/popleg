/*
   Poptropica island sweep — run from the browser console.

   Open a game page (local or deployed), then paste this file into devtools, or from
   the same origin run:
       fetch('tools/pop-sweep.js').then(r => r.text()).then(eval)

   Each island boots a whole Ruffle instance, so the sweep no longer tries all 38 at
   once: it checks CHUNK islands per run, saves the ones that finished, and asks you
   to run the same command again. That bounds memory, and a crash costs one chunk
   instead of the whole run.

   Run the command once per chunk until it prints the full summary. To start over:
       window.__popSweepReset = true
   To boot more islands per run (default 8):
       window.__popSweepChunk = 15
   To check just a few islands, without touching saved progress:
       window.__popSweepOnly = ["Tribal","Vampire","Villain","West"]

   The entry room comes from the client's own table (framework/data/config.xml). Most
   islands enter at "<Island>Main"; Early starts in City2, Shark in Mainstreet, Time
   in Present, Haunted in Haunted1, LegendarySwords in Landing, and Demo (absent from
   the table) in LandPrototypeAS2. Asking those six for "scene<Island>Main.swf" is a
   404 that says nothing about the island.

   Keep the tab focused: browsers throttle background tabs and a throttled iframe
   looks exactly like a stall.

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

  const CHUNK = 8;                    // islands per run; override with window.__popSweepChunk
  const PER_ISLAND_TIMEOUT = 30000;   // give up waiting for a scene after this
  const RETRY_TIMEOUT = 35000;        // one clean retry for a row that saw no scene
  const POLL = 250;                   // how often to look inside the frame
  const TEARDOWN = 200;               // let the player unload before the frame goes
  const GAP = 800;                    // and a breath between islands

  const base = location.pathname.replace(/[^/]*$/, "");   // game folder, with trailing slash
  const KEY = "pop-sweep:" + base;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rows = [];
  const startedAt = performance.now();

  const only = Array.isArray(window.__popSweepOnly) ? window.__popSweepOnly.slice() : null;
  if (window.__popSweepReset) {
    window.__popSweepReset = false;
    try { localStorage.removeItem(KEY); } catch (err) {}
  }

  let progress = { rows: [] };
  if (!only) {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (saved && Array.isArray(saved.rows)) progress = saved;
    } catch (err) {}
  }

  // A bigger chunk means fewer runs but a heavier tab. Every finished island is saved
  // immediately, so even a crash costs only the island in flight, not the chunk.
  const chunk = Math.min(Math.max(parseInt(window.__popSweepChunk, 10) || CHUNK, 1), ISLANDS.length);
  const done = new Set(progress.rows.map(r => r.island));
  const queue = only
    ? ISLANDS.filter(n => only.indexOf(n) !== -1)
    : ISLANDS.filter(n => !done.has(n)).slice(0, chunk);

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
    frame.width = "320";
    frame.height = "240";
    frame.style.cssText = "width:320px;height:240px;position:fixed;left:-9999px;top:0;border:0";
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

    // The frame owns a WASM player and a WebGL surface. Destroy the player and blank
    // the document before dropping the frame; otherwise they accumulate run after run
    // until the tab dies - which is exactly what an unbounded 38-island sweep did.
    try {
      const w = frame.contentWindow;
      const player = w && w.RufflePlayer && w.RufflePlayer.newest && w.RufflePlayer.newest();
      if (player && typeof player.destroy === "function") player.destroy();
    } catch (err) {}
    try { frame.src = "about:blank"; } catch (err) {}
    await sleep(TEARDOWN);
    frame.remove();
    await sleep(GAP);

    return { scene: scene, failed: failed, reqs: reqs, recent: recent, ms: Math.round(performance.now() - t0) };
  }

  const rooms = await entryRooms();

  if (only && !queue.length) {
    console.warn("pop-sweep: none of " + only.join(", ") + " are known islands");
  } else if (queue.length) {
    console.log("%cpop-sweep: " + queue.length + " island(s) from " + base + " · chunk " + chunk, "font-weight:bold");
    console.log("keep this tab focused until this chunk finishes");
  }

  for (const name of queue) {
    const room = rooms[name] || "";
    let r = await probe(name, room, PER_ISLAND_TIMEOUT);
    let retried = false;

    // A hidden iframe is throttled to a crawl and its resource list simply stops
    // growing - indistinguishable from a real stall without a second look.
    if (r.scene === "NONE" && !r.failed.length) {
      retried = true;

      console.log("  " + name + ": no scene after " + (PER_ISLAND_TIMEOUT / 1000) + "s, retrying once");
      const again = await probe(name, room, RETRY_TIMEOUT);
      r = { scene: again.scene, failed: again.failed, reqs: again.reqs, recent: again.recent, ms: r.ms + again.ms };
    }

    const row = {
      island: name,
      room: room,
      ms: r.ms,
      scene: r.scene,
      // Keep the array, not a display string: the summary counts failures with
      // failed.length, and "-" has a length of 1.
      failed: r.failed,
      reqs: r.reqs,
      recent: r.recent
    };
    if (retried) row.retried = true;
    rows.push(row);

    if (!only) {
      progress.rows.push(row);
      try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch (err) {}
    }

    console.log(
      String(rows.length).padStart(2) + "/" + queue.length + "  " +
      name.padEnd(16) + String(row.ms).padStart(6) + "ms  " +
      row.scene.padEnd(34) +
      (room ? "room:" + room + "  " : "") +
      (retried ? "retried  " : "") +
      (row.failed.length ? "FAIL" : "ok")
    );

    if (row.scene === "NONE" && row.recent.length)
      console.log("      stalled after: " + row.recent.join(", "));
  }

  const allRows = only
    ? rows
    : ISLANDS.map(n => progress.rows.find(r => r.island === n)).filter(Boolean);
  const remaining = ISLANDS.filter(n => !allRows.some(r => r.island === n));

  if (!only && remaining.length) {
    console.log("%cchunk done · " + allRows.length + "/" + ISLANDS.length + " islands checked",
                "font-weight:bold");
    console.log("left: " + remaining.join(", "));
    console.log("run the same command again to continue; progress is saved in this browser");
    console.log("to start over: window.__popSweepReset = true");
    return;
  }

  const secs = ((performance.now() - startedAt) / 1000).toFixed(1);
  const summary = {
    finishedAt: new Date().toISOString(),
    tookSeconds: Number(secs),
    ok: allRows.filter(r => !r.failed.length && r.scene !== "NONE").length,
    failed: allRows.filter(r => r.failed.length).map(r => r.island),
    noScene: allRows.filter(r => !r.failed.length && r.scene === "NONE").map(r => r.island),
    retried: allRows.filter(r => r.retried).map(r => r.island),
    rows: allRows
  };

  window.__sweepResult = summary;

  console.log("%c=== done in " + secs + "s · ok " + summary.ok + " · failed " +
              summary.failed.length + " · no scene " + summary.noScene.length + " ===",
              "font-weight:bold");
  if (console.table) console.table(allRows);

  const text = JSON.stringify(summary);
  console.log("---- copy this line and paste it back ----");
  console.log(text);
  try { await navigator.clipboard.writeText(text); console.log("(also copied to your clipboard)"); } catch (err) {}

  if (!only) {
    try { localStorage.removeItem(KEY); } catch (err) {}
  }

  return summary;
})();
