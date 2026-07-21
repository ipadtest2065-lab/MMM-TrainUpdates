/* global Module, Log, moment */

/*
 * MMM-TrainUpdates
 * A MagicMirror² module that shows real-time train departures between
 * a "from" station and a "to" station, using the Transport for NSW
 * Trip Planner API.
 *
 * Inspired by CptMeetKat/MMM-NextTrains (https://github.com/CptMeetKat/MMM-NextTrains),
 * extended to support a from -> to journey search instead of a single
 * departure-board station.
 */
Module.register("MMM-TrainUpdates", {

	// Default config. Anything set in config.js under `config` overrides these.
	defaults: {
		apiKey: "",                 // Your TfNSW Open Data API key
		fromStation: "Central Station",
		toStation: "Town Hall Station",
		maxTrips: 5,                // How many upcoming trips to show
		updateInterval: 60 * 1000,  // How often to refresh data (ms)
		retryDelay: 5000,           // Delay before retrying after a fetch error (ms)
		animationSpeed: 1000,       // Fade speed when updating the DOM (ms)
		showPlatform: true,
		showDelay: true,
		lateCriticalLimitMin: 10,   // Minutes late before a departure is flagged red
		timeFormat: 24,             // 24 or 12
		fade: true,
		fadePoint: 0.25,
	},

	requiresVersion: "2.15.0",

	start: function () {
		Log.info("Starting module: " + this.name);
		this.trips = [];
		this.loaded = false;
		this.errorMessage = null;
		this.scheduleUpdate(0);
	},

	getStyles: function () {
		return ["MMM-TrainUpdates.css"];
	},

	getScripts: function () {
		return ["moment.js"];
	},

	scheduleUpdate: function (delay) {
		const nextLoad = delay !== undefined ? delay : this.config.updateInterval;
		clearTimeout(this.updateTimer);
		this.updateTimer = setTimeout(() => {
			this.sendSocketNotification("GET_TRAIN_UPDATES", {
				identifier: this.identifier,
				apiKey: this.config.apiKey,
				fromStation: this.config.fromStation,
				toStation: this.config.toStation,
				maxTrips: this.config.maxTrips,
			});
		}, nextLoad);
	},

	socketNotificationReceived: function (notification, payload) {
		if (!payload || payload.identifier !== this.identifier) {
			return;
		}

		if (notification === "TRAIN_UPDATES_RESULT") {
			this.trips = payload.trips;
			this.loaded = true;
			this.errorMessage = null;
			this.updateDom(this.config.animationSpeed);
			this.scheduleUpdate();
		} else if (notification === "TRAIN_UPDATES_ERROR") {
			this.errorMessage = payload.error;
			this.loaded = true;
			this.updateDom(this.config.animationSpeed);
			this.scheduleUpdate(this.config.retryDelay);
		}
	},

	getHeader: function () {
		if (this.data.header) {
			return this.data.header;
		}
		return this.config.fromStation + " \u2192 " + this.config.toStation;
	},

	getDom: function () {
		const wrapper = document.createElement("div");
		wrapper.className = "mmm-train-updates";

		if (!this.config.apiKey) {
			wrapper.className += " dimmed light small";
			wrapper.innerHTML = "Please set an <code>apiKey</code> in config.js for MMM-TrainUpdates.";
			return wrapper;
		}

		if (this.errorMessage) {
			wrapper.className += " dimmed light small";
			wrapper.innerHTML = "MMM-TrainUpdates: " + this.errorMessage;
			return wrapper;
		}

		if (!this.loaded) {
			wrapper.className += " dimmed light small";
			wrapper.innerHTML = "Loading train updates &hellip;";
			return wrapper;
		}

		if (this.trips.length === 0) {
			wrapper.className += " dimmed light small";
			wrapper.innerHTML = "No upcoming trips found.";
			return wrapper;
		}

		const table = document.createElement("table");
		table.className = "small train-table";

		this.trips.forEach((trip, index) => {
			const row = document.createElement("tr");
			row.className = "train-row";

			// Departure time cell
			const timeCell = document.createElement("td");
			timeCell.className = "align-left time-cell";
			timeCell.innerHTML = this.formatTime(trip.estimatedDeparture);
			row.appendChild(timeCell);

			// Line / service cell
			const lineCell = document.createElement("td");
			lineCell.className = "align-left bright line-cell";
			lineCell.innerHTML = trip.line || "";
			row.appendChild(lineCell);

			// Destination cell
			const destCell = document.createElement("td");
			destCell.className = "align-left dest-cell";
			destCell.innerHTML = trip.destination || "";
			row.appendChild(destCell);

			// Platform cell
			if (this.config.showPlatform) {
				const platformCell = document.createElement("td");
				platformCell.className = "align-center platform-cell";
				platformCell.innerHTML = trip.platform ? "Plat " + trip.platform : "";
				row.appendChild(platformCell);
			}

			// Delay cell
			if (this.config.showDelay) {
				const delayCell = document.createElement("td");
				delayCell.className = "align-right delay-cell";
				if (trip.isRealtime && trip.delayMinutes !== 0) {
					const sign = trip.delayMinutes > 0 ? "+" : "";
					delayCell.innerHTML = sign + trip.delayMinutes + "m";
					if (trip.delayMinutes >= this.config.lateCriticalLimitMin) {
						delayCell.className += " late-critical";
					} else if (trip.delayMinutes > 0) {
						delayCell.className += " late";
					}
				} else if (trip.isRealtime) {
					delayCell.innerHTML = "on time";
					delayCell.className += " on-time";
				} else {
					delayCell.innerHTML = "";
				}
				row.appendChild(delayCell);
			}

			if (this.config.fade && this.config.fadePoint < 1) {
				let fadePoint = this.config.fadePoint;
				if (fadePoint < 0) fadePoint = 0;
				const startingPoint = this.trips.length * fadePoint;
				const steps = this.trips.length - startingPoint;
				if (index >= startingPoint) {
					const currentStep = index - startingPoint;
					row.style.opacity = 1 - (1 / steps) * currentStep;
				}
			}

			table.appendChild(row);
		});

		wrapper.appendChild(table);
		return wrapper;
	},

	formatTime: function (isoString) {
		if (!isoString) return "--:--";
		const fmt = this.config.timeFormat === 24 ? "HH:mm" : "h:mm a";
		if (typeof moment === "function") {
			return moment(isoString).format(fmt);
		}
		const d = new Date(isoString);
		return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: this.config.timeFormat !== 24 });
	},
});
