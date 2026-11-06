/*
   Follow-up to pop-sweep.js: the six islands that need an explicit room.

   Three have no <Island>Main scene but are reached through the travel map with a
   room (Early/City2, Shark/Mainstreet, Time/Present). Three have no entry scene at
   all and are absent from the travel map (Haunted, LegendarySwords, Demo) - for
   those this tries the first room in each folder, purely to see whether the scene
   itself renders.

   Run from the console on the game page:
       fetch('tools/pop-rooms.js').then(r => r.text()).then(eval)
   or paste this file. Keep the tab in front.
*/
(async () => {
  const CASES = [
    { island: "Early", room: "City2",     expect: "travel map pair" },
    { island: "Shark", room: "Mainstreet", expect: "travel map pair" },
    { island: "Time",  room: "Present",   expect: "travel map pair" },
    { island: "Haunted", room: "Haunted1", expect: "unlisted island, first room" },
    { island: "LegendarySwords", room: "Landing", expect: "unlisted island, first room" },
    { island: "Demo", room: "LandPrototypeAS2", expect: "unlisted island, first room" }
  ];

  const TIMEOUT = 30000, POLL = 250;
  const base = location.pathname.replace(/[^/]*$/, "");
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const rows = [];

  console.log("%cpop-rooms: " + CASES.length + " island/room cases", "font-weight:bold");

  for (const c of CASES) {
    const frame = document.createElement("iframe");
    frame.style.cssText = "width:480px;height:360px;position:fixed;left:-9999px;top:0;border:0";
    document.body.appendChild(frame);

    const t0 = performance.now();
    frame.src = base + "base.html?island=" + encodeURIComponent(c.island) +
                "&room=" + encodeURIComponent(c.room) + "&state=return_user_standard";

    let scene = "NONE", failed = [], reqs = 0;
    const deadline = t0 + TIMEOUT;

    while (performance.now() < deadline) {
      await sleep(POLL);
      let entries;
      try {
        const w = frame.contentWindow;
        if (!w || !w.performance) continue;
        entries = w.performance.getEntriesByType("resource");
      } catch (err) { continue; }

      reqs = entries.length;
      const bad = entries.filter(e => e.responseStatus >= 400);
      if (bad.length) failed = bad.map(e => e.responseStatus + " " + String(e.name).split("/").pop());

      const sc = entries.filter(e => /scenes\/island\w+\/scene\w+\.swf/i.test(e.name));
      if (sc.length) {
        scene = String(sc[0].name).split("/").pop() + " [" + sc[0].responseStatus + "]";
        break;
      }
    }

    const row = {
      island: c.island, room: c.room, scene: scene,
      failed: failed, reqs: reqs, ms: Math.round(performance.now() - t0), note: c.expect
    };
    rows.push(row);

    console.log((c.island + "/" + c.room).padEnd(28) + row.scene.padEnd(36) +
                (failed.length ? "FAIL " + failed.join(", ") : "ok"));

    frame.remove();
    await sleep(500);
  }

  const summary = {
    finishedAt: new Date().toISOString(),
    ok: rows.filter(r => !r.failed.length && r.scene !== "NONE").length,
    failed: rows.filter(r => r.failed.length).map(r => r.island + "/" + r.room),
    rows: rows
  };
  window.__roomsResult = summary;

  console.log("%c=== " + summary.ok + "/" + rows.length + " clean ===", "font-weight:bold");
  if (console.table) console.table(rows);
  const text = JSON.stringify(summary);
  console.log("---- copy this line and paste it back ----");
  console.log(text);
  try { await navigator.clipboard.writeText(text); } catch (err) {}

  return summary;
})();
