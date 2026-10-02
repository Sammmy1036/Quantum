<p align="center">
  <img src="images/quantum-banner.svg" alt="Quantum by microTech" width="820">
</p>

<p align="center">
  <b>A 3D navigation map, route planner, contract tracker and trade companion for Star Citizen.</b><br>
  Stanton · Pyro · Nyx
</p>

---

Quantum runs next to Star Citizen on Windows. It reads your `/showlocation` coordinates and the game's own log to show where you are on a live 3D map of the system, plans and guides multi-stop routes, tracks your hauling contracts from pickup to delivery, and, with a free UEX token, finds profitable trade routes, compares ships and fits components.

> **Fan project.** Quantum is an unofficial Star Citizen fan tool. It isn't affiliated with or endorsed by Cloud Imperium Games. It never changes game files or memory: it only reads `Game.log` and your clipboard, and (if you ask it to) types `/showlocation` into chat for you.

## Contents

- [Features](#features)
- [Getting started](#getting-started)
- [Connecting UEX (trade data)](#connecting-uex-trade-data)
- [Using Quantum in game](#using-quantum-in-game)
- [The tabs](#the-tabs)
- [Keeping the data up to date](#keeping-the-data-up-to-date)
- [Your data and privacy](#your-data-and-privacy)
- [Credits](#credits)

## Features

**Map and navigation**
- Interactive 3D map of Stanton, Pyro and Nyx: planets, moons, stations, cities, outposts, Lagrange points and gateways.
- Your position from `/showlocation`, and from the game log between readings (landed at, talking to traffic control, just took off from).
- Plan routes with as many stops as you like, optimise their order, and follow a live guide to the next stop.
- An in-game overlay you toggle with a hotkey, and a hotkey that types `/showlocation` for you.
- Places no dataset has a position for (Pyro and Nyx gateways, Wikelo emporiums, new outposts) are listed, and one `/showlocation` puts them on the map for good.

**Contracts**
- Hauling contracts are picked up from `Game.log` automatically, with their pickups and drop-offs pinned on the map.
- A tracker for each contract (*Accepted › Collected › Out for delivery › Delivered*) with a parcel-style tracking number.
- Mark cargo as picked up yourself when the game doesn't report it.

**Trade and ships** (with a free [UEX](https://uexcorp.space) token)
- **Commodities:** where each commodity is cheapest to buy and sells best, with stock, prices and a map view.
- **Trade Routes:** ranked routes from where you are, for your ship's cargo and your budget, with a full route page and preview. Plan a route and track it *Planned › Bought › In transit › Sold*, including auto loading and unloading fees.
- **Vehicles:** every ship and ground vehicle with specs, and where to buy or rent it.
- **Components:** ship components by category with game-file stats and where to buy them.
- **My Fleet:** your ships with their stock loadouts. Swap components, see the stats change, and get an EM/IR estimate with Combat (SCM) and Travel (NAV) modes.

## Getting started

### Requirements

- Windows 10 or 11

### Install and run

```bash
git clone https://github.com/Sammmy1036/Quantum.git
cd Quantum
pip install -r requirements.txt
python import_data.py     # first run only: downloads the map data
python app.py
```

`import_data.py` downloads the community navigation data and builds `locations.json`. Run it again any time to refresh it; your own waypoints and calibrations are kept.

### Settings

Quantum creates `settings.json` the first time you change something. Until then it uses its defaults, so there's nothing to set up. `settings.example.json` shows what the file looks like.

## Connecting UEX (trade data)

The **Commodities**, **Trade Routes**, **Vehicles**, **Components** and **My Fleet** tabs use live, community-reported data from the [UEX API](https://uexcorp.space/api/documentation/). Access is free but needs your own token. These tabs stay hidden until you add one.

1. Sign in at [uexcorp.space](https://uexcorp.space) and go to **[My Apps](https://uexcorp.space/api/apps)**.
2. Create an app (any name, e.g. "Quantum") and copy its **access token**.
3. In Quantum, click **Settings** (bottom left) and find **Trade data (UEX)**.
4. Paste the token and press **Save**. Quantum checks it with UEX first and only keeps it if it works.

The new tabs appear straight away, and Settings shows how many UEX trade terminals were matched to places on the map.

Things to know:
- The token is stored only in your local `settings.json`. **Don't commit that file** (see [privacy](#your-data-and-privacy)).
- UEX allows 120 requests a minute. Quantum caches its data (places for a day, prices and routes for 30 minutes) and stays well under the limit.
- UEX prices are reported by players. They can be out of date, so check the terminal before you buy.

## Using Quantum in game

| Key | What it does |
|---|---|
| **F9** | Show or hide Quantum over the game |
| **F10** | Types `/showlocation` in game chat, so the map knows exactly where you are |

You can change both in **Settings**. The `/showlocation` key starts unset on a fresh install; pick one in Settings (F10 works well).

- **Game.log** is found automatically while Star Citizen is running. Quantum reads it for contracts and approximate positions.
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
| **Trade Routes** | *Find Routes* ranks profitable runs. *Planned Routes* tracks the ones you're doing, or ones you enter yourself |
| **Vehicles** | Ships and vehicles with specs, where to buy and where to rent |
| **Components** | Ship components with game-file stats and shops |
| **My Fleet** | Your ships, their loadouts, component swaps, and EM/IR with power settings |

## Keeping the data up to date

Positions come from community datasets, and component stats come from the game files.

- **Map data:** `python import_data.py`
- **Component stats after a patch:** export the game data with [unp4k](https://github.com/dolkensp/unp4k), then run:
  ```bash
  python export_resources.py "C:\path\to\unpacked\Data"
  python build_component_stats.py "C:\path\to\components.json" "C:\path\to\resources.json"
  ```
  This rebuilds `component_stats.json` (weapon DPS, shields, quantum drives, power and signatures).
- **Gateways and other places without positions:** dock there, press F10, then click **I'm here: set position** on the place's card. Positions are saved to `places.json`, which is safe to share.

## Your data and privacy

Quantum keeps everything on your PC. These files hold personal data and are listed in `.gitignore`:

| File | Holds |
|---|---|
| `settings.json` | Your UEX token, hotkeys, route, fleet and planned trade routes |
| `uex_cache/` | Cached UEX and wiki data |

If you forked the repo before `settings.json` was ignored, stop tracking it (your copy stays):

```bash
git rm --cached settings.json
git commit -m "Stop tracking personal settings"
```

## Credits

Quantum stands on the work of the Star Citizen community:

- **[UEX Corp](https://uexcorp.space)**: commodity prices, trade routes, vehicles and items.
- **[Star Citizen Wiki](https://starcitizen.tools)** and its **[API](https://api.star-citizen.wiki)**: ship data, loadouts and pictures.
- **[Valalol / Star-Citizen-Navigation](https://github.com/Valalol/Star-Citizen-Navigation)**: verified Stanton positions.
- **[starnav](https://crates.io/crates/starnav)**: Stanton, Pyro and Nyx points of interest.
- **[unp4k](https://github.com/dolkensp/unp4k)**: game-file extraction for component stats.

Star Citizen®, Roberts Space Industries® and Cloud Imperium® are registered trademarks of Cloud Imperium Rights LLC. microTech is a fictional in-game company; its name is used here in the spirit of the game.
