/*
 * node_helper.js for MMM-TrainUpdates
 *
 * Queries the Transport for NSW (TfNSW) Open Data "Trip Planner" API
 * (/v1/tp/trip) for journeys between a from-station and a to-station,
 * and extracts real-time departure info for the train leg of each trip.
 *
 * Docs: https://opendata.transport.nsw.gov.au/  (Trip Planner APIs product)
 * You need a free TfNSW Open Data account + API key with the
 * "Trip Planner APIs" product enabled.
 */

const NodeHelper = require("node_helper");

const TP_BASE_URL = "https://api.transport.nsw.gov.au/v1/tp/trip";
const STOP_FINDER_URL = "https://api.transport.nsw.gov.au/v1/tp/stop_finder";

module.exports = NodeHelper.create({

	start: function () {
		console.log("Starting node_helper for: " + this.name);
		// Cache resolved "station name" -> "TfNSW stop id" lookups so we don't
		// hit stop_finder on every single refresh cycle.
		this.stopIdCache = {};
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "GET_TRAIN_UPDATES") {
			this.getTrainUpdates(payload);
		}
	},

	// Resolves a plain station name (e.g. "St Leonards Station") to a single,
	// unambiguous TfNSW stop id via the stop_finder endpoint. This avoids the
	// "multiple matches" (-8011) error the /trip endpoint throws when you pass
	// a name directly with type_origin=any/type_destination=any.
	async resolveStopId(name, apiKey) {
		const cacheKey = name.trim().toLowerCase();
		if (this.stopIdCache[cacheKey]) {
			return this.stopIdCache[cacheKey];
		}

		const params = new URLSearchParams({
			outputFormat: "rapidJSON",
			coordOutputFormat: "EPSG:4326",
			type_sf: "any",
			name_sf: name,
			TfNSWSF: "true",
			version: "10.2.1.42",
		});

		const response = await fetch(`${STOP_FINDER_URL}?${params.toString()}`, {
			headers: {
				Authorization: `apikey ${apiKey}`,
				Accept: "application/json",
			},
		});

		if (!response.ok) {
			throw new Error(`stop_finder HTTP ${response.status} for "${name}"`);
		}

		const data = await response.json();
		const locations = Array.isArray(data.locations) ? data.locations : [];

		// Prefer an actual stop/station (not a suburb or POI). TfNSW rapidJSON
		// uses type: "stop" for stops/stations. Results are generally sorted
		// by match quality already, so take the first stop match.
		const best =
			locations.find((l) => l.type === "stop") ||
			locations.find((l) => l.type === "platform") ||
			locations[0];

		if (!best || !best.id) {
			throw new Error(`No matching station found for "${name}"`);
		}

		console.log(
			`[MMM-TrainUpdates] Resolved "${name}" -> id=${best.id} name=${best.name} type=${best.type}`
		);

		const resolved = { id: best.id, name: best.name };
		this.stopIdCache[cacheKey] = resolved;
		return resolved;
	},

	async getTrainUpdates(payload) {
		const { identifier, apiKey, fromStation, toStation, maxTrips, trainOnly, excludedModes } = payload;

		if (!apiKey) {
			this.sendSocketNotification("TRAIN_UPDATES_ERROR", {
				identifier,
				error: "Missing apiKey in config.js",
			});
			return;
		}

		try {
			const [origin, destination] = await Promise.all([
				this.resolveStopId(fromStation, apiKey),
				this.resolveStopId(toStation, apiKey),
			]);

			const now = new Date();
			const itdDate = this.formatDate(now); // YYYYMMDD
			const itdTime = this.formatTime(now);  // HHmm

			const params = new URLSearchParams({
				outputFormat: "rapidJSON",
				coordOutputFormat: "EPSG:4326",
				depArrMacro: "dep",
				itdDate,
				itdTime,
				type_origin: "stop",
				name_origin: origin.id,
				type_destination: "stop",
				name_destination: destination.id,
				calcNumberOfTrips: String(Math.max(maxTrips || 5, 5)),
				TfNSWTR: "true",
				version: "10.2.1.42",
			});

			// Mode filtering. TfNSW's journey planner (EFA-based) uses
			// exclMOT_<id>=1 per mode to exclude, plus excludedMeans=checkbox
			// to switch the API into "exclusion mode". Mode ids: 1=train,
			// 2=metro, 4=light rail, 5=bus, 7=coach, 9=ferry, 11=school bus.
			// trainOnly:true (default) excludes everything except train (1).
			const modesToExclude = Array.isArray(excludedModes) && excludedModes.length
				? excludedModes
				: trainOnly !== false
					? [2, 4, 5, 7, 9, 11]
					: [];

			if (modesToExclude.length > 0) {
				params.set("excludedMeans", "checkbox");
				modesToExclude.forEach((mot) => {
					params.set(`exclMOT_${mot}`, "1");
				});
			}

			const url = `${TP_BASE_URL}?${params.toString()}`;

			const response = await fetch(url, {
				headers: {
					Authorization: `apikey ${apiKey}`,
					Accept: "application/json",
				},
			});

			if (!response.ok) {
				let errText = `HTTP ${response.status}`;
				if (response.status === 401 || response.status === 403) {
					errText = "Invalid or unauthorised API key";
				}
				this.sendSocketNotification("TRAIN_UPDATES_ERROR", {
					identifier,
					error: errText,
				});
				return;
			}

			const data = await response.json();

			if (Array.isArray(data.systemMessages) && data.systemMessages.some((m) => m.type === "error")) {
				const msg = data.systemMessages.find((m) => m.type === "error");
				this.sendSocketNotification("TRAIN_UPDATES_ERROR", {
					identifier,
					error: "TfNSW API error: " + msg.text,
				});
				return;
			}

			console.log(
				`[MMM-TrainUpdates] TfNSW returned ${Array.isArray(data.journeys) ? data.journeys.length : 0} journeys for ${fromStation} -> ${toStation}`
			);

			// TfNSW resolves names like "St Leonards Station, St Leonards" —
			// keep just the station part for display.
			const cleanOriginName = origin.name ? origin.name.split(",")[0].trim() : "";
			const trips = this.parseTrips(data, maxTrips || 5, cleanOriginName);

			if (trips.length === 0) {
				// Log a compact snapshot of what came back so we can see why
				// nothing survived parsing (wrong leg types, missing fields, etc).
				console.log(
					"[MMM-TrainUpdates] No trips parsed. Raw journeys sample:",
					JSON.stringify((data.journeys || []).slice(0, 1), null, 2)
				);
			}

			this.sendSocketNotification("TRAIN_UPDATES_RESULT", {
				identifier,
				trips,
			});
		} catch (err) {
			console.error("MMM-TrainUpdates fetch error:", err);
			this.sendSocketNotification("TRAIN_UPDATES_ERROR", {
				identifier,
				error: "Could not reach TfNSW API (" + err.message + ")",
			});
		}
	},

	// Pull the train leg out of each journey and normalise the fields the
	// front-end module needs. Falls back gracefully if a field is missing,
	// since the exact shape of TfNSW's rapidJSON response can vary slightly
	// by journey (e.g. walking legs at the start/end).
	parseTrips(data, maxTrips, originStationName) {
		if (!data || !Array.isArray(data.journeys)) {
			return [];
		}

		const trips = [];

		for (const journey of data.journeys) {
			if (!Array.isArray(journey.legs) || journey.legs.length === 0) continue;

			// Only legs that are an actual TRAIN service (product class 1).
			// TfNSW sometimes appends a trailing non-train continuation past
			// the requested destination (e.g. a light rail hop from the
			// train platform to a nearby interchange) even with trainOnly
			// mode filtering applied — ignore anything that isn't a train so
			// it can't be mistaken for where the journey "really" ends.
			const trainLegs = journey.legs.filter(
				(l) => l.transportation && l.transportation.product && l.transportation.product.class === 1
			);
			if (trainLegs.length === 0) continue;

			const boardLeg = trainLegs[0];
			const finalLeg = trainLegs[trainLegs.length - 1];
			const transportLegs = trainLegs;

			const legOrigin = boardLeg.origin || {};
			const finalDestination = finalLeg.destination || {};
			const transportation = boardLeg.transportation || {};

			const plannedTime = legOrigin.departureTimePlanned;
			const estimatedTime = legOrigin.departureTimeEstimated || plannedTime;
			const isRealtime = Boolean(legOrigin.departureTimeEstimated);

			// Total journey time: boarding departure -> final leg's arrival,
			// so a trip requiring a change (e.g. T9 then T1) is measured
			// end-to-end rather than just the first service.
			const arrivalTime = finalDestination.arrivalTimeEstimated || finalDestination.arrivalTimePlanned || null;

			let delayMinutes = 0;
			if (isRealtime && plannedTime && estimatedTime) {
				delayMinutes = Math.round((new Date(estimatedTime) - new Date(plannedTime)) / 60000);
			}

			let durationMinutes = null;
			if (estimatedTime && arrivalTime) {
				durationMinutes = Math.round((new Date(arrivalTime) - new Date(estimatedTime)) / 60000);
			}

			// Platform properties are usually a short code like "STL2" — pull
			// just the trailing number so we can display "Platform 2".
			const rawPlatform =
				(legOrigin.properties && (legOrigin.properties.platform || legOrigin.properties.PlatformName)) || null;
			const platformMatch = rawPlatform && rawPlatform.match(/(\d+)\s*$/);
			const platform = platformMatch ? platformMatch[1] : rawPlatform;

			// One badge per distinct service used (e.g. ["T9", "T1"] for a
			// journey that changes trains partway).
			const lines = transportLegs
				.map((l) => l.transportation && (l.transportation.disassembledName || l.transportation.number))
				.filter(Boolean);

			trips.push({
				plannedDeparture: plannedTime || null,
				estimatedDeparture: estimatedTime || plannedTime || null,
				arrivalTime,
				durationMinutes,
				isRealtime,
				delayMinutes,
				changes: transportLegs.length - 1,
				lines: lines.length ? lines : [""],
				line: lines[0] || "",
				destination:
					(transportation.destination && transportation.destination.name) ||
					boardLeg.destination?.name ||
					"",
				platform,
				originStationName: originStationName || "",
			});

			if (trips.length >= maxTrips) break;
		}

		return trips;
	},

	formatDate(d) {
		const y = d.getFullYear();
		const m = String(d.getMonth() + 1).padStart(2, "0");
		const day = String(d.getDate()).padStart(2, "0");
		return `${y}${m}${day}`;
	},

	formatTime(d) {
		const h = String(d.getHours()).padStart(2, "0");
		const min = String(d.getMinutes()).padStart(2, "0");
		return `${h}${min}`;
	},
});
