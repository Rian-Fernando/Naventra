# Third-party data & attribution

Naventra is released under the MIT License (see `LICENSE`). It relies on the
following free, public data sources at runtime and build time. Naventra is an
independent project and is **not affiliated with, endorsed by, or connected to
any of them or to any aviation authority.**

| Data | Source | Terms |
|---|---|---|
| Live aircraft (ADS-B) | [airplanes.live](https://airplanes.live), [adsb.lol](https://adsb.lol), [adsb.fi](https://adsb.fi) | Community ADS-B networks, free & keyless |
| Weather (METAR / TAF) | [NOAA / NWS Aviation Weather Center](https://aviationweather.gov) | U.S. government, public domain |
| Flight routes | [adsbdb.com](https://adsbdb.com) | Free & keyless |
| Airports & runways | [OurAirports](https://ourairports.com/data/) | Public domain |

Airport and runway geometry in `src/data/airports.js` is generated from the
OurAirports public-domain dataset by `scripts/gen-airports.mjs`.

**Not for operational use.** Naventra is a demonstration and portfolio project.
It must not be used for real-world navigation, flight planning, or air traffic
control.
