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

module.exports = NodeHelper.create({

	start: function () {
		console.log("Starting node_helper for: " + this.name);
	},

	socketNotificationReceived: function (notification, payload) {
		if (notification === "GET_TRAIN_UPDATES") {
			this.getTrainUpdates(payload);
		}
	},

	async getTrainUpdates(payload) {
		const { identifier, apiKey, fromStation, toStation, maxTrips } = payload;

		if (!apiKey) {
			this.sendSocketNotification("TRAIN_UPDATES_ERROR", {
				identifier,
				error: "Missing apiKey in config.js",
			});
			return;
		}

		try {
			const now = new Date();
			const itdDate = this.formatDate(now); // YYYYMMDD
			const itdTime = this.formatTime(now);  // HHmm

			const params = new URLSearchParams({
				outputFormat: "rapidJSON",
				coordOutputFormat: "EPSG:4326",
				depArrMacro: "dep",
				itdDate,
				itdTime,
				type_origin: "any",
				name_origin: fromStation,
				type_destination: "any",
				name_destination: toStation,
				calcNumberOfTrips: String(Math.max(maxTrips || 5, 5)),
				TfNSWTR: "true",
				version: "10.2.1.42",
			});

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
			const trips = this.parseTrips(data, maxTrips || 5);

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
	parseTrips(data, maxTrips) {
		if (!data || !Array.isArray(data.journeys)) {
			return [];
		}

		const trips = [];

		for (const journey of data.journeys) {
			if (!Array.isArray(journey.legs)) continue;

			// Prefer the first "train" leg (product class 1) in the journey.
			// If none is tagged as class 1, fall back to the first leg that
			// isn't a footpath/walk.
			let leg = journey.legs.find(
				(l) => l.transportation && l.transportation.product && l.transportation.product.class === 1
			);
			if (!leg) {
				leg = journey.legs.find((l) => l.transportation);
			}
			if (!leg) continue;

			const origin = leg.origin || {};
			const transportation = leg.transportation || {};

			const plannedTime = origin.departureTimePlanned;
			const estimatedTime = origin.departureTimeEstimated || plannedTime;
			const isRealtime = Boolean(origin.departureTimeEstimated);

			let delayMinutes = 0;
			if (isRealtime && plannedTime && estimatedTime) {
				delayMinutes = Math.round((new Date(estimatedTime) - new Date(plannedTime)) / 60000);
			}

			const platform =
				(origin.properties && (origin.properties.platform || origin.properties.PlatformName)) || null;

			trips.push({
				plannedDeparture: plannedTime || null,
				estimatedDeparture: estimatedTime || plannedTime || null,
				isRealtime,
				delayMinutes,
				line: transportation.disassembledName || transportation.number || transportation.name || "",
				destination:
					(transportation.destination && transportation.destination.name) ||
					journey.legs[journey.legs.length - 1].destination?.name ||
					"",
				platform,
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
