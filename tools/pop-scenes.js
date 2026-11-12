/*
   Every room in every island — browser console tool.

   pop-sweep.js proves each island boots and requests its entry scene. This walks the
   whole scene tree instead: for every "scenes/island<X>/scene<Room>.swf" listed in
   assets.json it opens

       base.html?island=<X>&room=<Room>

   and waits for the client to request that file. The page's getInput() hands the room
   to the client unchanged, so a room named here takes the same path a door or the
   travel map would.

   It is slow by nature: each room boots its own Ruffle instance, about 10-15s, and
   there are hundreds of them - a full pass takes hours. So it runs two islands
   (and at most ROOM_CAP rooms) per invocation and saves every finished room:

       fetch('tools/pop-scenes.js').then(r => r.text()).then(eval)

   Run the same command again to continue. Switches:
       window.__popScenesChunk = 4            islands per run (default 2)
       window.__popScenesRooms = 25           rooms per run (default 40, 0 = no cap)
       window.__popScenesParallel = 3         rooms probed at once (default 3, max 6)
       window.__popScenesRoomList = [...]     only these "Island/Room" entries, saved progress
       window.__popScenesKey = "..."           override the progress storage key
       window.__popScenesIslands = ["Astro"]  only these, ignores saved progress
       window.__popScenesReset = true         forget saved progress

   Row meanings:
       ok        asked for the expected scene, got 200
       FAIL      some request returned 4xx/5xx (the row names them)
       WRONG     a different scene loaded than the one asked for
       NO SCENE  nothing requested before the deadline; retried once, then reported

   Keep the tab focused while a chunk runs: a throttled iframe produces NO SCENE.

   A 200 proves the scene was requested and served, not that it plays correctly when
   opened cold - cutscenes and UI clips are normally given variables by the scene that
   launches them, so they may look inert here without being broken.
*/
(async () => {
  const CHUNK = 2;                    // islands per run
  const ROOM_CAP = 40;                // rooms per run; the biggest 2-island pair is 61
  const PARALLEL = 3;                 // rooms in flight; one stalled room must not block the rest
  const PER_ROOM_TIMEOUT = 30000;     // give up waiting for the scene after this
  const RETRY_TIMEOUT = 30000;        // one clean retry for a row that saw nothing
  const POLL = 250;
  const TEARDOWN = 200;               // let the player unload before the frame goes
  const GAP = 600;                    // and a breath between rooms

  const base = location.pathname.replace(/[^/]*$/, "");   // game folder, with trailing slash
  const KEY = window.__popScenesKey || ("pop-scenes:" + base);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const startedAt = performance.now();

  // A hidden tab throttles timers and iframes, which is what turns a live room into
  // a false NO SCENE. Wait for the tab to be visible instead of burning the timeout.
  async function waitVisible() {
    if (document.visibilityState === "visible") return;

    await new Promise(function (resolve) {
      const check = function () {
        if (document.visibilityState === "visible") {
          document.removeEventListener("visibilitychange", check);
          resolve();
        }
      };

      document.addEventListener("visibilitychange", check);
    });
  }

  const only = Array.isArray(window.__popScenesIslands) ? window.__popScenesIslands.slice() : null;

  const rawRoomList = Array.isArray(window.__popScenesRoomList) ? window.__popScenesRoomList.slice() : null;
  const roomList = rawRoomList
    ? rawRoomList.map(String).filter(function (key) {
        const room = key.split("/").pop() || "";
        return /^[^/]+\/[^/]+$/.test(key) && !/^(AdGround|AdSky|AdUnder)/i.test(room);
      })
    : null;
  const target = roomList ? new Set(roomList) : null;

  if (window.__popScenesReset) {
    window.__popScenesReset = false;
    try { localStorage.removeItem(KEY); } catch (err) {}
  }

  let progress = { rows: [] };
  if (!only) {
    try {
      const saved = JSON.parse(localStorage.getItem(KEY) || "null");
      if (saved && Array.isArray(saved.rows)) progress = saved;
    } catch (err) {}
  }

  // Drop ad clips saved by earlier runs so the next write uses the corrected inventory.
  if (!only && Array.isArray(progress.rows)) {
    progress.rows = progress.rows.filter(function (row) {
      return row && !/^AdGround/i.test(String(row.room || ""));
    });

    if (target) {
      progress.rows = progress.rows.filter(function (row) {
        return target.has(row.island + "/" + row.room);
      });
    }
  }

  /*
     assets.json is the deployment's own file list, so the inventory cannot drift from
     what is actually served. Only "scene<Name>.swf" files are rooms: the bare clips
     beside them (toolsTray.swf, playerHUD.swf) are loaded by other scenes, never as a
     room, and asking for one would 404 for the wrong reason.
  */
  async function inventory() {
    const res = await fetch("assets.json", { cache: "no-cache" });
    if (!res.ok) throw new Error(res.status + " assets.json");

    const list = (await res.json()).files || [];
    const byIsland = {};

    list.forEach(function (file) {
      const m = /^scenes\/(island[^/]+)\/(scene[^/]+)\.swf$/i.exec(file);
      if (!m) return;

      const island = m[1].replace(/^island/i, ""), room = m[2].replace(/^scene/i, "");

      // AdGroundH* are ad clips, not rooms; opening one as a room only yields NO SCENE.
      if (/^AdGround/i.test(room)) return;

      (byIsland[island] = byIsland[island] || []).push(room);
    });

    Object.keys(byIsland).forEach(function (island) { byIsland[island].sort(); });

    return byIsland;
  }

  let byIsland, islands;

  try {
    byIsland = await inventory();
    islands = Object.keys(byIsland).sort();
  } catch (err) {
    console.error("pop-scenes: cannot read assets.json - " + (err.message || err));
    return;
  }

  const totalRooms = islands.reduce(function (n, island) {
    return n + byIsland[island].filter(function (room) {
      return !target || target.has(island + "/" + room);
    }).length;
  }, 0);
  const done = new Set(progress.rows.map(function (r) { return r.island + "/" + r.room; }));
  const chunk = Math.min(Math.max(parseInt(window.__popScenesChunk, 10) || CHUNK, 1), islands.length);

  const capInput = parseInt(window.__popScenesRooms, 10);
  const roomCap = capInput === 0 ? 0 : (capInput > 0 ? capInput : ROOM_CAP);
  const parallelInput = parseInt(window.__popScenesParallel, 10);
  const parallel = Math.min(Math.max(parallelInput || PARALLEL, 1), 6);

  const pending = only
    ? islands.filter(function (island) { return only.indexOf(island) !== -1; })
    : islands.filter(function (island) {
          return byIsland[island].some(function (room) {
            const key = island + "/" + room;
            return !done.has(key) && (!target || target.has(key));
          });
      });

  // Build the run: at most `chunk` islands and `roomCap` rooms, skipping anything a
  // previous run finished. A big pair is simply split across two runs.
  const queue = [];

  if (only) {
    pending.forEach(function (island) { queue.push({ island: island, rooms: byIsland[island] }); });
  } else {
    let budget = roomCap || Infinity;

    for (const island of pending) {
      if (queue.length >= chunk || budget <= 0) break;

      const rooms = byIsland[island].filter(function (room) {
        const key = island + "/" + room;
        return !done.has(key) && (!target || target.has(key));
      });
      if (!rooms.length) continue;

      const take = budget === Infinity ? rooms : rooms.slice(0, budget);

      queue.push({ island: island, rooms: take });
      budget -= take.length;
    }
  }

  const queueRooms = queue.reduce(function (n, job) { return n + job.rooms.length; }, 0);

  if (only && !queue.length) {
    console.warn("pop-scenes: none of " + only.join(", ") + " are islands in assets.json");
    return;
  }

  if (queue.length) {
    console.log("%cpop-scenes: " + queueRooms + " room(s) in " + queue.length + " island(s) · " +
                progress.rows.length + "/" + totalRooms + " done before this run", "font-weight:bold");
    console.log("islands: " + queue.map(function (job) { return job.island + " (" + job.rooms.length + ")"; }).join(", "));
    console.log("~10-15s per room; probing " + parallel + " at a time; keep this tab focused");
  }

  async function probe(island, room, timeoutMs) {
    const expected = "scene" + room + ".swf";
    const frame = document.createElement("iframe");
    frame.width = "320";
    frame.height = "240";
    frame.style.cssText = "width:320px;height:240px;position:fixed;left:-9999px;top:0;border:0";
    document.body.appendChild(frame);

    const t0 = performance.now();
    frame.src = base + "base.html?island=" + encodeURIComponent(island) +
                "&room=" + encodeURIComponent(room);

    let scene = "", status = 0, failed = [], reqs = 0, recent = [];
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

      const bad = entries.filter(function (e) { return e.responseStatus >= 400; });
      if (bad.length)
        failed = [...new Set(bad.map(function (e) { return e.responseStatus + " " + String(e.name).split("/").pop(); }))];

      recent = entries.slice(-6).map(function (e) {
        return String(e.name).split("/").pop() + " [" + (e.responseStatus || "?") + "]";
      });

      // The framework loads exactly one scene per page, so the first hit is the answer.
      const sc = entries.filter(function (e) { return /\/scenes\/island[^/]+\/scene[^/]+\.swf$/i.test(e.name); });
      if (sc.length) {
        scene = String(sc[sc.length - 1].name).split("/").pop();
        status = sc[sc.length - 1].responseStatus;
        break;
      }
    }

    // Same teardown as the island sweep: the frame owns WASM memory and a WebGL
    // surface, and dropping the iframe alone does not give them back promptly.
    try {
      const w = frame.contentWindow;
      const player = w && w.RufflePlayer && w.RufflePlayer.newest && w.RufflePlayer.newest();
      if (player && typeof player.destroy === "function") player.destroy();
    } catch (err) {}
    try { frame.src = "about:blank"; } catch (err) {}
    await sleep(TEARDOWN);
    frame.remove();
    await sleep(GAP);

    return { scene: scene, status: status, failed: failed, reqs: reqs, recent: recent,
             ms: Math.round(performance.now() - t0), expected: expected };
  }

  const rows = [];
  let doneHere = 0;

  const work = [];

  queue.forEach(function (job) {
    job.rooms.forEach(function (room) { work.push({ island: job.island, room: room }); });
  });

  async function runOne(job) {
    const island = job.island,
          room = job.room;

    await waitVisible();

    let r = await probe(island, room, PER_ROOM_TIMEOUT);
    let retried = false;

    // A background-throttled iframe never requests anything; one clean retry tells
    // that apart from a genuine stall.
    if (!r.scene && !r.failed.length) {
      retried = true;
      console.log("  " + island + "/" + room + ": nothing after " + (PER_ROOM_TIMEOUT / 1000) + "s, retrying once");

      await waitVisible();
      const again = await probe(island, room, RETRY_TIMEOUT);
      r = { scene: again.scene, status: again.status, failed: again.failed, reqs: again.reqs,
            recent: again.recent, ms: r.ms + again.ms, expected: r.expected };
    }

    const row = {
      island: island,
      room: room,
      expected: r.expected,
      ms: r.ms,
      scene: r.scene,
      status: r.status,
      failed: r.failed,
      reqs: r.reqs
    };

    if (r.scene !== r.expected || r.failed.length) row.recent = r.recent;   // diagnosis only where it matters
    if (retried) row.retried = true;

    rows.push(row);
    doneHere++;

    if (!only) {
      progress.rows.push(row);
      try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch (err) {}
    }

    const verdict = row.failed.length ? "FAIL"
                  : !row.scene ? "NO SCENE"
                  : row.scene !== row.expected ? "WRONG"
                  : "ok";

    console.log(
      "[" + doneHere + "/" + queueRooms + "] " + island.padEnd(15) + room.padEnd(22) +
      (row.scene || "NONE").padEnd(28) + String(row.ms).padStart(6) + "ms  " + verdict
    );

    if (verdict !== "ok" && row.recent) console.log("      saw: " + row.recent.join(", "));
  }

  async function worker() {
    while (work.length) {
      await runOne(work.shift());
    }
  }

  await Promise.all(Array.from({ length: Math.min(parallel, work.length) }, worker));

  const allRows = only ? rows : progress.rows;
  const seen = new Set(allRows.map(function (r) { return r.island + "/" + r.room; }));
  const remaining = [];

  if (target) {
    target.forEach(function (key) { if (!seen.has(key)) remaining.push(key); });
  } else {
    islands.forEach(function (island) {
      const left = byIsland[island].filter(function (room) { return !seen.has(island + "/" + room); }).length;
      if (left) remaining.push(island + " (" + left + ")");
    });
  }

  const runMs = performance.now() - startedAt;

  if (!only && remaining.length) {
    progress.elapsedMs = (progress.elapsedMs || 0) + runMs;
    try { localStorage.setItem(KEY, JSON.stringify(progress)); } catch (err) {}

    console.log("%cchunk done · " + allRows.length + "/" + totalRooms + " rooms checked · this run " +
                (runMs / 1000).toFixed(1) + "s", "font-weight:bold");
    console.log(target ? "rooms left: " + remaining.length : "islands left: " + remaining.join(", "));
    console.log("run the same command again to continue; progress is saved in this browser");
    console.log("to start over: window.__popScenesReset = true");
    return;
  }

  const totalMs = only ? runMs : (progress.elapsedMs || 0) + runMs;
  const failed = allRows.filter(function (r) { return r.failed.length; });
  const noScene = allRows.filter(function (r) { return !r.failed.length && !r.scene; });
  const wrong = allRows.filter(function (r) { return !r.failed.length && r.scene && r.scene !== r.expected; });
  const ok = allRows.length - failed.length - noScene.length - wrong.length;

  const perIsland = {};
  allRows.forEach(function (r) {
    const b = perIsland[r.island] = perIsland[r.island] || { rooms: 0, ok: 0, failed: 0, noScene: 0, wrong: 0 };
    b.rooms++;
    if (r.failed.length) b.failed++;
    else if (!r.scene) b.noScene++;
    else if (r.scene !== r.expected) b.wrong++;
    else b.ok++;
  });

  const secs = (totalMs / 1000).toFixed(1);
  const summary = {
    finishedAt: new Date().toISOString(),
    tookSeconds: Number(secs),
    rooms: allRows.length,
    ok: ok,
    failed: failed.map(function (r) { return r.island + "/" + r.room + " " + r.failed.join(","); }),
    noScene: noScene.map(function (r) { return r.island + "/" + r.room; }),
    wrong: wrong.map(function (r) { return r.island + "/" + r.room + " -> " + r.scene; }),
    islands: perIsland
  };

  window.__sceneResult = summary;

  console.log("%c=== done in " + secs + "s · rooms " + allRows.length + " · ok " + ok +
              " · failed " + failed.length + " · no scene " + noScene.length +
              " · wrong scene " + wrong.length + " ===", "font-weight:bold");

  failed.forEach(function (r) { console.log("  FAIL  " + r.island + "/" + r.room + "  " + r.failed.join(", ")); });
  wrong.forEach(function (r) { console.log("  WRONG " + r.island + "/" + r.room + " asked " + r.expected + ", got " + r.scene); });
  noScene.forEach(function (r) { console.log("  NONE  " + r.island + "/" + r.room + (r.recent ? "  saw: " + r.recent.join(", ") : "")); });
  if (console.table) console.table(perIsland);

  const text = JSON.stringify(summary);
  console.log("---- copy this line and paste it back ----");
  console.log(text);
  try { await navigator.clipboard.writeText(text); console.log("(also copied to your clipboard)"); } catch (err) {}

  if (!only) {
    try { localStorage.removeItem(KEY); } catch (err) {}
  }

  return summary;
})();
