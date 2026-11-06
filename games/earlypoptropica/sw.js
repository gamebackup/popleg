/*
    Local account backend for the Early Poptropica mirror.

    The client posts to a set of PHP endpoints (login.php, part-register.php, ...).
    A static host cannot answer those - it returns 405/501 - so this service worker
    intercepts them for this folder only and answers from IndexedDB in this browser.
    Nothing leaves the machine; accounts are per-browser, per-origin.

    Scope note: a worker controls its clients, not their URLs - once the page is
    controlled, every subresource it asks for passes through this handler, including
    root-absolute ones like /getPrefix.php. That is why the legacy bodies below have
    to be here as well as in the page's fetch shim: Ruffle's LoadVars uses
    XMLHttpRequest, which the page shim never sees.
*/
"use strict";

const DB_NAME = "pop-accounts";
const STORE = "accounts";

/* ---------- IndexedDB helpers (localStorage is unavailable in a SW) ---------- */

function openDB() {
    return new Promise(function (resolve, reject) {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () {
            if (!req.result.objectStoreNames.contains(STORE))
                req.result.createObjectStore(STORE, { keyPath: "username" });
        };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
    });
}

function withStore(mode, fn) {
    return openDB().then(function (db) {
        return new Promise(function (resolve, reject) {
            const tx = db.transaction(STORE, mode);
            const out = fn(tx.objectStore(STORE));
            tx.oncomplete = function () { resolve(out && out.result); };
            tx.onerror = function () { reject(tx.error); };
        });
    });
}

const getAccount = function (username) { return withStore("readonly", function (s) { return s.get(username); }); };
const putAccount = function (rec) { return withStore("readwrite", function (s) { return s.put(rec); }); };
const allAccounts = function () { return withStore("readonly", function (s) { return s.getAll(); }); };

/* ------------------------------- HTTP helpers ------------------------------- */

function formResponse(obj) {
    return new Response(new URLSearchParams(obj).toString(), {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
}

function jsonResponse(obj) {
    return new Response(JSON.stringify(obj), {
        status: 200,
        headers: { "Content-Type": "application/json" }
    });
}

function textResponse(body) {
    return new Response(body, {
        status: 200,
        headers: { "Content-Type": "text/plain; charset=utf-8" }
    });
}

async function requestParams(request) {
    const url = new URL(request.url);
    const out = {};
    url.searchParams.forEach(function (v, k) { out[k] = v; });

    if (request.method === "POST") {
        try {
            const text = await request.clone().text();
            new URLSearchParams(text).forEach(function (v, k) { out[k] = v; });
        } catch (err) { /* body not readable as text - fine */ }
    }

    return out;
}

function newDbId() {
    return String(Date.now()) + String(Math.floor(Math.random() * 1000));
}

/* -------------------------------- endpoints -------------------------------- */

const ENDPOINTS = {
    /* Returns JSON: gameplay.swf parses it with jsonLib and reads the character. */
    async "login.php"(p) {
        const username = (p.username || p.sender || p.name || p.user || "").trim();
        const pass = p.pass_hash || p.passhash || p.hash || p.password || "";

        if (!username)
            return formResponse({ error: "noname" });

        const rec = await getAccount(username.toLowerCase());
        if (!rec)
            return formResponse({ error: "noname" });

        if (rec.pass_hash && pass && rec.pass_hash !== pass)
            return formResponse({ error: "wrongpass" });

        const payload = {
            ok: 1,
            success: 1,
            dbid: rec.dbid,
            username: rec.username,
            gender: rec.gender || "M",
            age: rec.age || "",
            look: rec.look || "",
            credits: rec.credits || "75",
            mem_status: "0",
            memstatus: "0",
            mem_date: "0",
            parent_email: "",
            has_parent_email: "0",
            Registred: "1",
            registered: "1",
            island: rec.island || p.island || "Early",
            room: rec.room || p.room || "City2",
            last_room: rec.room || p.room || "City2",
            // gameplay.swf's doLogin reads these exact spellings off the parsed
            // json ("lastIsland", "lastRoom", "password") when it restores the
            // character, so send all the variants rather than only snake_case.
            lastIsland: rec.island || p.island || "Early",
            lastRoom: rec.room || p.room || "City2",
            password: pass || rec.pass_hash || "",
            returning: "1"
        };

        // Two different callers share this endpoint and parse it differently:
        // sceneHome.swf loads the reply into a LoadVars (it looks for wrongpass /
        // noname), while gameplay.swf parses JSON with jsonLib. They are told apart
        // by parameter name - the login screen sends "sender", the in-game relogin
        // sends "username".
        return p.sender ? formResponse(payload) : jsonResponse(payload);
    },

    /* Character data for the account being created. */
    async "part-register.php"(p) {
        const username = (p.username || p.sender || p.name || "").trim().toLowerCase() || "player";
        const rec = (await getAccount(username)) || {
            username: username,
            dbid: newDbId(),
            credits: "75",
            created: Date.now()
        };

        rec.fname = p.fname || p.firstName || rec.fname || "";
        rec.lname = p.lname || p.lastName || rec.lname || "";
        rec.look = p.look || p.char || p.avatar || rec.look || "";
        rec.gender = p.gender || rec.gender || "M";
        rec.age = p.age || rec.age || "";
        rec.pass_hash = p.pass_hash || rec.pass_hash || "";

        await putAccount(rec);
        return formResponse({ success: 1, ok: 1, username: username, dbid: rec.dbid });
    },

    /* Account creation from the "Save your game" dialog. */
    async "register.php"(p) {
        const username = (p.username || p.name || "").trim();
        const pass = p.pass_hash || p.passhash || p.password || "";

        if (!username)
            return formResponse({ error: "noname" });

        const key = username.toLowerCase();
        if (await getAccount(key))
            return formResponse({ error: "namenottaken" });

        const rec = {
            username: key,
            pass_hash: pass,
            dbid: newDbId(),
            credits: "75",
            gender: p.gender || "M",
            look: p.look || p.char || "",
            created: Date.now()
        };

        await putAccount(rec);
        return formResponse({ success: 1, ok: 1, dbid: rec.dbid, username: key });
    },

    /* Restores accounts from an exported file, without clobbering a live account. */
    async "__pop_import_accounts.php"(p, request) {
        let payload;

        try {
            payload = JSON.parse(await request.text());
        } catch (err) {
            return jsonResponse({ ok: 0, error: "badjson" });
        }

        const list = Array.isArray(payload) ? payload : (payload && payload.accounts) || [];
        let imported = 0, skipped = 0;

        for (const rec of list) {
            if (!rec || typeof rec.username !== "string" || !rec.username.trim()) {
                skipped++;
                continue;
            }

            const username = rec.username.trim().toLowerCase();

            if (await getAccount(username)) {   // already here: leave it alone
                skipped++;
                continue;
            }

            await putAccount({
                username: username,
                pass_hash: rec.pass_hash || "",
                dbid: rec.dbid || newDbId(),
                credits: rec.credits || "75",
                gender: rec.gender || "M",
                age: rec.age || "",
                look: rec.look || "",
                created: rec.created || Date.now()
            });
            imported++;
        }

        return jsonResponse({ ok: 1, imported: imported, skipped: skipped });
    },

    /* Removes one account from this browser (used by the on-page manager). */
    async "__pop_delete_account.php"(p) {
        const username = (p.username || "").trim().toLowerCase();
        if (!username)
            return jsonResponse({ ok: 0, error: "noname" });

        await withStore("readwrite", function (s) { return s.delete(username); });
        return jsonResponse({ ok: 1, deleted: username });
    },

    /* Remembers which avatar belongs to an account, so switching accounts brings
       back the character that was being played. */
    async "__pop_set_char.php"(p, request) {
        let payload;

        try {
            payload = JSON.parse(await request.text());
        } catch (err) {
            return jsonResponse({ ok: 0, error: "badjson" });
        }

        const username = String(payload.username || "").trim().toLowerCase();
        if (!username)
            return jsonResponse({ ok: 0, error: "noname" });

        const rec = await getAccount(username);
        if (!rec)
            return jsonResponse({ ok: 0, error: "noname" });

        rec.char = payload.char && typeof payload.char === "object" ? payload.char : null;
        await putAccount(rec);

        return jsonResponse({ ok: 1, username: username });
    },

    /*
       Session check. StatusManager posts here (login/pass_hash/dbid) on island
       changes and treats any reply without status_ok as a failure: onLoad runs
       showStatusPopup(), which loads popups/status.swf. This mirror has no such
       file, so the 404 left the travelmap blocked mid-click. Answer the check the
       way the live site did and the popup is never asked for.
    */
    async "status.php"() {
        // StatusManager.checkStatus reads receiver.answer and, unless it is exactly
        // "ok", calls showStatusPopup(receiver.answer, receiver.message) - which loads
        // popups/status.swf over the scene. status_ok alone sent every check down that
        // path; it stays for the callers that read that field instead.
        return formResponse({ answer: "ok", status_ok: "1", success: 1, ok: 1 });
    },

    /*
       Telemetry sink. gameplay.swf fires brain//track.php on every room load, and the
       static host answered it with the placeholder file, so each beacon cost a round
       trip and a log line for data nobody reads. Answer it here, empty, and it never
       leaves the browser.
    */
    async "track.php"() {
        return new Response("", {
            status: 200,
            headers: { "Content-Type": "text/plain; charset=utf-8" }
        });
    },

    /* Debug helper: lets the page list what is stored in this browser. */
    async "__pop_accounts.php"() {
        return jsonResponse({ accounts: await allAccounts() });
    }
};

// The "Save your game" dialog (popups/register.swf) posts to reguser.php, which used
// to be root-absolute ("/reguser.php") and so fell outside this worker's scope. The
// SWF's string was byte-patched to "../"-less "./reguser.php" - same length - and it
// takes the same fields as register.php.
ENDPOINTS["reguser.php"] = ENDPOINTS["register.php"];

/*
   Bodies for the client's legacy calls. These mirror the page's fetch shim, and
   they are not redundant with it: the shim only patches window.fetch, while
   Ruffle's LoadVars goes through XMLHttpRequest and reaches only this worker.

   getPrefix is the one that broke the live site. It used to fall through to the
   generic ok=1&success=1, which carries no prefix field: the client kept its
   default base and resolved "framework/data/config.xml" against the site root,
   where the file does not exist (404), instead of against this folder.
*/
const LEGACY = {
    "get_campaign_list.php": "ok=1&success=1",
    "visit_scene.php": "ok=1&success=1",
    "reset_island.php": "answer=ok&success=1&ok=1",
    // Basename, not the full path: the handler looks up url.pathname's last segment.
    "save_feed_item.php": "answer=ok&success=1&ok=1",
    "get_promo_code_uses.php": "answer=ok&json={}",
    "time_limited_is_active.php": "answer=ok&json={}",
    "get_scene_photos.php": "answer=ok&json={}",
    "get_user_photos.php": "answer=ok&json={}",
    "get_island_info.php": "answer=noIslandInfo",
    "list_finished_islands.php": "answer=ok&islands_json={}"
};

function legacyBody(name) {
    // Empty, not ".": the client concatenates this straight onto paths like
    // "framework/data/config.xml", so a dot would make them ".framework/...".
    if (name === "getPrefix.php") return "prefix=";

    // No key on purpose: the client reads the parameter NAME as the timestamp
    // ("for (_loc1_ in receiver) islandTimes[island].end = _loc1_").
    if (name === "time.php") return Math.floor(Date.now() / 1000) + "=";

    return LEGACY[name] || "ok=1&success=1";
}

/* --------------------------------- plumbing -------------------------------- */

self.addEventListener("install", function () { self.skipWaiting(); });
self.addEventListener("activate", function (event) { event.waitUntil(self.clients.claim()); });

self.addEventListener("fetch", function (event) {
    /*
       A getURL("") from the client reaches here as a request with an empty URL, and
       new URL("") throws - which aborts the handler and surfaces as "Failed to load ''.
       A ServiceWorker intercepted the request and encountered an unexpected error."
       Ignore anything that will not parse instead of failing the whole event.
    */
    let url;

    try {
        if (!event.request.url) {
            // getURL("") - answer it, so the console does not report a failed load.
            event.respondWith(new Response(null, { status: 204 }));
            return;
        }
        url = new URL(event.request.url);
    } catch (err) {
        return;
    }

    if (url.origin !== self.location.origin) return;

    // Page loads always come from the network. This mirror is edited in place, and a
    // cached copy silently keeps the old script alive - including across the island
    // changes that reload home.htm - so the fix written to disk never runs.
    if (event.request.mode === "navigate") {
        event.respondWith(fetch(event.request, { cache: "no-store" }).catch(function () {
            return fetch(event.request);
        }));
        return;
    }

    const name = url.pathname.split("/").pop();
    if (!name || !name.endsWith(".php")) return;      // only the client's .php calls

    const handler = ENDPOINTS[name];
    event.respondWith((async function () {
        try {
            const params = await requestParams(event.request);
            if (handler) return await handler(params, event.request);

            // Anything else the client asks for: succeed quietly instead of 501/404,
            // with the body that call actually reads where we know it.
            return textResponse(legacyBody(name));
        } catch (err) {
            return formResponse({ error: "dberror", ok: 0 });
        }
    })());
});
