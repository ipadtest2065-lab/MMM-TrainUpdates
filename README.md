# MMM-TrainUpdates

A MagicMirror² module that shows real-time train departures **from one
station to another**, using the Transport for NSW (TfNSW) Open Data
Trip Planner API.

This is inspired by [MMM-NextTrains](https://github.com/CptMeetKat/MMM-NextTrains),
which only supports a single "departure board" station. This module
instead searches an actual journey between a `fromStation` and a
`toStation`, so you get live updates for trips that actually get you
where you're going (rather than every train leaving a station).

<img width="576" height="733" alt="image" src="https://github.com/user-attachments/assets/d6b98c27-a4b8-4835-80d1-c47ee2fc55af" />


## Dependencies

- A [MagicMirror²](https://github.com/MagicMirrorOrg/MagicMirror) installation
- Node 18+ (ships with MagicMirror; needed for the built-in `fetch`)
- A free TfNSW Open Data account + API key

No sqlite / GTFS-static database is required — this module calls the
live Trip Planner API directly, so setup is much lighter than the
original NextTrains module.

## Installation

1. Clone/copy this folder into your `MagicMirror/modules` directory as `MMM-TrainUpdates`.
2. `cd ~/MagicMirror/modules/MMM-TrainUpdates`
3. No `npm install` is required — the helper only uses Node's built-in `fetch`.
4. Create a free account at https://opendata.transport.nsw.gov.au/
5. Create an "Application" and enable the **Trip Planner APIs** product, then copy your API key.
6. Add the module to `config.js` (see below).

## Config

### Example configuration for config.js

```js
{
	module: "MMM-TrainUpdates",
	position: "top_right",
	header: "Home \u2192 Work", // optional, overrides the default "from -> to" header
	config: {
		apiKey: "YOUR_TFNSW_API_KEY",
		fromStation: "Central Station",
		toStation: "Town Hall Station",
		maxTrips: 5,
		updateInterval: 60 * 1000,
		showPlatform: true,
		showDelay: true,
		lateCriticalLimitMin: 10,
		timeFormat: 24
	}
}
```

### Config options

| Option                 | Description                                                                                     | Default             |
| ----------------------- | ------------------------------------------------------------------------------------------------ | -------------------- |
| `apiKey`                | Your TfNSW Open Data API key. **Required.**                                                     | `""`                 |
| `fromStation`           | Name of the origin station, e.g. `"Central Station"`.                                           | `"Central Station"`  |
| `toStation`             | Name of the destination station, e.g. `"Town Hall Station"`.                                    | `"Town Hall Station"`|
| `maxTrips`              | Maximum number of upcoming trips to display.                                                    | `5`                   |
| `updateInterval`        | How often to refresh data, in milliseconds.                                                     | `60000` (1 min)       |
| `retryDelay`            | Delay before retrying after a failed request, in milliseconds.                                  | `5000`                |
| `showPlatform`          | Show the departure platform if available.                                                       | `true`                |
| `showDelay`             | Show how many minutes late/on-time each service is.                                             | `true`                |
| `lateCriticalLimitMin`  | Minutes late before a departure is highlighted red.                                             | `10`                  |
| `timeFormat`            | `24` or `12` hour clock.                                                                         | `24`                  |
| `fade`                  | Fade out rows further down the list.                                                            | `true`                |
| `fadePoint`             | Where the fade effect starts (0 - 1).                                                            | `0.25`                |

You can swap `fromStation`/`toStation` for any two NSW train stations,
platforms, or interchanges — the API resolves plain station names for
you, so exact stop IDs aren't required (though you can use one if you
want to be precise, e.g. for a specific platform).

## Notes / things to check after install

- TfNSW's API occasionally tweaks field names in its rapidJSON
  response. If trips stop showing after a TfNSW update, the most
  likely culprit is `node_helper.js`'s `parseTrips()` function — open
  it and compare against a raw response from the API Explorer at
  https://opendata.transport.nsw.gov.au/ to see if any field names
  changed.
- If you get a 401/403 error in the module, double check the API key
  is correct and that the **Trip Planner APIs** product is enabled on
  your TfNSW application (each product must be added separately).
- Station names need to roughly match what TfNSW's stop-finder
  recognises. If a station isn't found, try the fuller name as shown
  on https://transportnsw.info/stops#/ (e.g. `"Strathfield Station"`
  rather than just `"Strathfield"`).
