# Poptropica: Legacy mirror

A static, local mirror of the Flashpoint Poptropica curation. Serve the folder over HTTP; local accounts use a service worker.

## Run

```sh
cd popleg
python3 -m http.server 8914 --bind 127.0.0.1
```

Open <http://127.0.0.1:8914/> (or `/index.html`).

## Membership

New and existing accounts default to member. Open **Accounts** and use **make free** or **make member** on the active account to test member-gated content. The active account's choice is restored on reload.

## Realms prototype

1. Open **Map** on the home page.
2. Choose **Realms (prototype)** at the end of the island grid.
3. The game loads the existing `Demo/LandPrototypeAS2` land prototype and its `toolsTray.swf`.
4. Use the top-left **Map** button to return to the island map.

This is the mirror's existing Land sandbox, not a full Realms reconstruction; no new scenes or assets were added. The Map control is also present on `base.html` and the legacy `home.htm` / `index.htm` / PHP-style page aliases.

Known limitation: some non-member gate scenes request `nonMemberBlock.swf`, which is not in the asset set and returns 404. The free-account status itself is reported correctly.
