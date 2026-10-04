<p align="center">
  <img src="images/quantum-banner.svg" alt="Quantum by microTech" width="820">
</p>

<p align="center">
  <b>A 3D navigation map, route planner, contract tracker, trade companion and datarunner tool for Star Citizen.</b><br>
  Stanton · Pyro · Nyx
</p>

---

Quantum runs next to Star Citizen on Windows. It reads your `/showlocation` coordinates and the game's own log to show where you are on a live 3D map of the system, plans and guides multi-stop routes, and tracks your hauling contracts from pickup to delivery. With a free UEX token it also finds profitable trade routes, compares ships and fits components. With a UEX datarunner account you can report terminal prices from inside Quantum, climb the ranks and keep trade data fresh for everyone.

> **Fan project.** Quantum is an unofficial Star Citizen fan tool. It isn't affiliated with or endorsed by Cloud Imperium Games. It never changes game files or memory: it only reads `Game.log` and your clipboard, and (if you ask it to) types `/showlocation` into chat and takes screenshots of the game window for price reports.

## Contents

- [Features](#features)
- [Getting started](#getting-started)
- [Connecting UEX (trade data)](#connecting-uex-trade-data)
- [Datarunner: reporting prices](#datarunner-reporting-prices)
- [Using Quantum in game](#using-quantum-in-game)
- [The tabs](#the-tabs)
- [The Quantum community](#the-quantum-community)
- [Updates](#updates)
- [Keeping the data up to date](#keeping-the-data-up-to-date)
- [Your data and privacy](#your-data-and-privacy)
- [Credits](#credits)

## Features

**Map and navigation**
- Interactive 3D map of Stanton, Pyro and Nyx: planets, moons, stations, cities, outposts, Lagrange points and gateways.
- Your position from `/showlocation`, and from the game log between readings (landed at, talking to traffic control, just took off from).
- Plan routes with as many stops as you like, optimise their order, and follow a live guide to the next stop.
- An in-game overlay you toggle with a hotkey, and a hotkey that types `/showlocation` for you.

**Contracts**
- Hauling contracts are picked up from `Game.log` automatically, with their pickups and drop-offs pinned on the map.
- A tracker for each contract (*Accepted › Collected › Out for delivery › Delivered*) with a parcel-style tracking number.
- Mark cargo as picked up yourself when the game doesn't report it.

**Trade and ships** (with a free [UEX](https://uexcorp.space) token)
- **Commodities:** where each commodity is cheapest to buy and sells best, with stock, prices and a map view.
- **Trade Routes:** ranked routes from where you are, for your ship's cargo and your budget, with a full route page and preview. Plan a route and track it *Planned › Bought › In transit › Sold*, including auto loading and unloading fees. Share a planned route and other Quantum users see it in *Find Routes* for a week.
- **Vehicles:** every ship and ground vehicle with specs, and where to buy or rent it.
- **Components:** (systems, avionics, weapons, mining). Each category has search and filters for size, grade, maker, where to get it and what fits your ships, plus sorting by price or by the stat that matters (DPS, shield HP, quantum speed, cooling). A component's page shows its game-file stats, where to buy it, whether it fits your ship.
- **My Fleet:** your ships with their stock loadouts. Swap components, see the stats change, and get an EM/IR estimate with Combat (SCM) and Travel (NAV) modes.

**Datarunner** (with a UEX datarunner account)
- Report a terminal's prices to UEX from Quantum: the terminal is picked from the game log, every row starts from UEX's current numbers, and most rows need one key press.
- **Jobs:** terminals with the most out-of-date prices, and stations that still need mapping.
- **My Reports:** what UEX did with each report, your star rating and your rank.
- **Top 10:** the best Quantum datarunners, with a title card for #1.
- **FAQ:** how ratings, ranks and jobs work.
- Approved reports show up for every Quantum user within seconds, rather than waiting for UEX to merge them.

## Getting started

### Requirements

- Windows 10 or 11

## Connecting UEX (trade data)

The **Commodities**, **Trade Routes**, **Datarunner**, **Vehicles**, **Components** and **My Fleet** tabs use live, community-reported data from the [UEX API](https://uexcorp.space/api/documentation/). Access is free but needs your own token. These tabs stay hidden until you add one.

1. Sign in at [uexcorp.space](https://uexcorp.space) and go to **[My Apps](https://uexcorp.space/api/apps)**.
2. Create an app (any name, e.g. "Quantum") and copy its **access token**.
3. In Quantum, click **Settings** (bottom left) and find **Trade data (UEX)**.
4. Paste it into **UEX Bearer Token** and press **Save**. Quantum checks it with UEX first and only keeps it if it works.

The new tabs appear straight away, and Settings shows how many UEX trade terminals were matched to places on the map.

Things to know:
- The token is stored only in your local `settings.json`.
- UEX allows 120 requests a minute. Quantum caches its data (places for a day, prices and routes for 30 minutes) and should stay well under the limit.
- UEX prices are reported by players. They can be out of date, so check the terminal before you buy.

## Datarunner: reporting prices

Reports go to UEX under your own account, so you need a UEX account with datarunner access turned on in your [UEX profile](https://uexcorp.space/account).

1. In **Settings → Trade data (UEX)**, paste your **UEX Secret Key** (from your UEX profile) and press **Save**. It's only used to send your reports and stays on your PC.
2. Go to a commodity kiosk. Land or dock and Quantum picks the terminal from the game log, or type it in the **Terminal** box.
3. Open the kiosk's list in game and take a screenshot: press your screenshot key (set it in **Settings**) or **Take screenshot** in Quantum. UEX checks every report against it, so data entry stays locked until there is one. For a long list, scroll and take another; they're joined into one picture.
4. Check each row. Matches the kiosk: **No Changes** (or Space). Different: type the stock and price and set the inventory bar. Gone from the kiosk: **Not Sold Here**. Keys: ↑ ↓ move, Space no changes, Enter edit, 1–7 inventory, G not sold here.
5. **Submit Report**, then follow it in **My Reports**.

Take screenshot only works while Star Citizen is running and a terminal is picked, and the Note box unlocks once a terminal is picked.

**Ratings and ranks**
- Every decided price row, picture and station position counts: approved is 5 stars, rejected is 1 star, and your rating is the average. Your first approved report sets you to 5.0.
- Ranks go by approved reports: Trainee (1), Runner (11), Field Analyst (26), Trade Analyst (51), Quantum Analyst (101).
- Rows still waiting for review, expired rows and test reports don't count. The **FAQ** view in the Datarunner tab has the details.

**Keep your reports approved:** only report what the kiosk shows right now, double-check prices more than 25% from UEX's average (they're held for manual review), and remember the same item at the same terminal can be reported once every 5 minutes. Repeated wrong reports can get your UEX datarunner access suspended.

## Using Quantum in game

| Key | What it does |
|---|---|
| **F9** | Show or hide Quantum over the game |
| **F10** | Types `/showlocation` in game chat, so the map knows exactly where you are |
| **Screenshot key** | Screenshots the kiosk for a datarunner report (unset until you pick one, e.g. F12) |

You can change all of them in **Settings**. The `/showlocation` key starts unset on a fresh install; pick one in Settings (F10 works well).

- **Game.log** is found automatically while Star Citizen is running. Quantum reads it for contracts, approximate positions, the terminal you're at and the game version.
- **Admin rights:** if Star Citizen (or the RSI Launcher) runs as administrator, Quantum must too, or Windows won't let its hotkeys type into the game. Settings has a **Restart Quantum as administrator** button.
- **When the game is closed**, Quantum shows "Star Citizen isn't running" and hides your old position.

## The tabs

| Tab | What it's for |
|---|---|
| **Route** | Search places, moons or services ("refinery", "refuel"); build, optimise and follow a route |
| **Contracts** | Your hauling contracts from the game log, with trackers and map pins |
| **Waypoints** | Places you've saved yourself |
| **POI** | Browse every place on the map |
| **Commodities** | Buy and sell prices for any commodity, as a picture grid with a detail page and map view |
| **Trade Routes** | *Find Routes* ranks profitable runs, including ones other users shared. *Planned Routes* tracks the ones you're doing, or ones you enter yourself |
| **Datarunner** | *Report Prices*, *Jobs*, *My Reports*, *Top 10* and *FAQ* |
| **Vehicles** | Ships and vehicles with specs, where to buy and where to rent |
| **Components** | Every component category, with filters, game-file stats, shops and fitting to your fleet |
| **My Fleet** | Your ships, their loadouts, component swaps, and EM/IR with power settings |

## The Quantum community

Quantum users share a few things through the Quantum community server (`quantumsc.ddnsgeek.com`):

- **Prices:** reports sent through Quantum are checked against UEX's own record and then shown to every Quantum user within seconds, marked ⚡. A report is shown for up to 72 hours, or until UEX's own data is newer, and is dropped as soon as UEX rejects it.
- **Station positions:** a station goes live on everyone's map once two datarunners' `/showlocation` readings agree. Quantum fetches new ones every 10 minutes.
- **Pictures:** anything with no picture (a commodity, component or vehicle) has a **Send a picture** button. Pictures are reviewed before they appear for everyone; **My Reports** shows each one as *Submitted*, *In Review*, *Approved*, *Live on Quantum* or *Rejected*.
- **Shared trade routes:** routes you share from *Planned Routes* appear in other users' *Find Routes* for a week.
- **Datarunner profiles and the Top 10:** your rank, star rating and report counts, kept under your UEX username so they survive reinstalling Quantum.

Nobody can add to or take from someone else's profile: a report only counts once UEX's own record shows that username sent it. Trusted contributors can be given a key by the server owner (**Settings → Trusted contributor key**); their pictures and station positions go live without waiting for review.

## Updates

Quantum checks GitHub Releases at start-up and when you press **Check for updates** in Settings. Settings shows the version you're running.

- **The Windows build** downloads the new `Quantum.exe`, checks its signature, and installs it after a restart. It only installs releases signed with Quantum's release key.
- **Running from source** (`python app.py`), Quantum tells you an update exists and links to the release; update with `git pull`.

Settings, fleet, reports and places live in files next to Quantum and aren't touched by updates.

## Keeping the data up to date

Positions come from community datasets, and component stats come from the game files.

- **Gateways and other places without positions:** dock there, press F10, then click **I'm here: set position** on the place's card (or **I'm here: map it** in Datarunner → Jobs). Positions are saved to `places.json`, which is safe to share, and sent to the community server so other users get them too.

## Your data and privacy

Your **UEX Bearer Token**, **UEX Secret Key** and **trusted contributor key** stay on your PC in `settings.json`. The UEX keys are only ever sent to UEX; the trusted contributor key is only sent to the Quantum community server.

Quantum talks to these services:

| Service | Why |
|---|---|
| **UEX** | Prices, terminals, vehicles and items, and the price reports you send |
| **Quantum community server** | Community prices, station positions, pictures, shared routes, datarunner profiles and the Top 10 |
| **Star Citizen Wiki** | Ship data, loadouts and pictures |
| **GitHub** | Checking for updates |

What the community server receives from you:
- **Datarunner reports:** the UEX report IDs and values of reports you send, under your UEX username.
- **Contributions:** station positions you set and pictures you send.
- **Shared routes:** routes you choose to share.
- **Your UEX profile:** your username and avatar link, for your profile and the Top 10. Your username and stats are visible to other Quantum users on the Top 10.

It never receives your UEX token or secret key. To turn the community features off, set `"community_url": "off"` in `settings.json`; Quantum then uses UEX's data alone.

| File | Holds |
|---|---|
| `settings.json` | Your UEX token and secret key, trusted contributor key, hotkeys, route, fleet and planned trade routes |
| `places.json` | Station positions you set with `/showlocation` |
| `community_places.json` | Station positions from other Quantum users |
| `datarunner_reports.json` | The reports you've sent and what UEX did with them |
| `datarunner_test/` | Test-mode reports, saved instead of sent |
| `uex_cache/` | Cached UEX and wiki data, and datarunner avatars |

## Credits

Quantum stands on the work of the Star Citizen community:

- **[UEX Corp](https://uexcorp.space)**: commodity prices, trade routes, vehicles, items and the datarunner program.
- **[Star Citizen Wiki](https://starcitizen.tools)** and its **[API](https://api.star-citizen.wiki)**: ship data, loadouts and pictures.
- **[Valalol / Star-Citizen-Navigation](https://github.com/Valalol/Star-Citizen-Navigation)**: verified Stanton positions.
- **[starnav](https://crates.io/crates/starnav)**: Stanton, Pyro and Nyx points of interest.
- **[unp4k](https://github.com/dolkensp/unp4k)**: game-file extraction for component stats.
- **Quantum datarunners**: the prices, station positions and pictures they share.

Star Citizen®, Roberts Space Industries® and Cloud Imperium® are registered trademarks of Cloud Imperium Rights LLC. microTech is a fictional in-game company; its name is used here in the spirit of the game.
