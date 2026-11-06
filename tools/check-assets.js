/*
    Asset check for the Early Poptropica mirror.

    Paste it into the browser console while the game page is open:

        fetch('../../tools/check-assets.js').then(r => r.text()).then(eval)

    or paste this whole file. It reads assets.json from the game folder, requests every
    listed file, and prints what is missing - the result is also copied to the clipboard
    as JSON, ready to send back.

    Scope: by default it checks scenes, popups, flashpoint shims and the root players,
    which is what actually breaks islands, rooms and menus. Add "#all" to the page URL
    (or set POP_CHECK_ALL = true first) to include the avatar part library too - that is
    ~4,800 requests and takes a few minutes.
*/
(async function checkAssets() {
    const dir = new URL("./", location.href);
    const wantAll = location.hash.indexOf("all") > -1 || window.POP_CHECK_ALL === true;

    let manifest;

    try {
        manifest = await (await fetch("assets.json", { cache: "no-store" })).json();
    } catch (err) {
        console.error("[check] assets.json is not deployed yet:", err);
        return { error: "no assets.json" };
    }

    const files = manifest.files || [],
          groups = ["scenes/", "popups/", "flashpoint/"],
          isRoot = function (file) { return file.indexOf("/") === -1; },
          picked = wantAll ? files.slice() : files.filter(function (file) {
              return isRoot(file) || groups.some(function (prefix) { return file.indexOf(prefix) === 0; });
          });

    const queue = picked.slice(),
          missing = [];

    let done = 0;

    async function probe(file) {
        const url = new URL(file, dir);

        for (let attempt = 0; attempt < 2; attempt++) {
            try {
                let res = await fetch(url, { method: "HEAD", cache: "no-store" });

                // A host that refuses HEAD still answers whether the file exists on GET.
                if (res.status === 405 || res.status === 501)
                    res = await fetch(url, { cache: "no-store", headers: { Range: "bytes=0-0" } });

                if (!res.ok) return res.status + " " + file;
                return null;
            } catch (err) {
                if (attempt === 1) return "ERR " + file + " (" + err.message + ")";
            }
        }
    }

    async function worker() {
        while (queue.length) {
            const file = queue.shift(),
                  bad = await probe(file);

            if (bad) missing.push(bad);
            if (++done % 100 === 0) console.log("[check] " + done + "/" + picked.length);
        }
    }

    const started = Date.now();

    await Promise.all(Array.from({ length: 10 }, worker));

    const report = {
        page: location.href,
        scope: wantAll ? "all" : "scenes+popups+flashpoint+root",
        checked: picked.length,
        missing: missing.length,
        manifestFiles: files.length,
        seconds: Math.round((Date.now() - started) / 1000),
        failures: missing
    };

    console.log("[check] " + report.checked + " checked, " + report.missing +
                " missing in " + report.seconds + "s (" + report.scope + ")");

    if (missing.length) console.log(missing.join("\n"));

    try {
        copy(JSON.stringify(report, null, 1));
        console.log("[check] report copied to the clipboard");
    } catch (err) { }

    return report;
})();
