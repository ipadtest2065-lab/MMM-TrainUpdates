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
		countdownRefresh: 15 * 1000, // How often to re-render the "X min" countdown (ms), no new fetch
		animationSpeed: 1000,       // Fade speed when updating the DOM (ms)
		showPlatform: true,
		showDelay: true,
		showDuration: true,
		trainOnly: true,            // Exclude all non-train modes (metro, light rail, bus, coach, ferry, school bus)
		excludedModes: [],          // Advanced: override which mode IDs to exclude, e.g. [2,4,5,7,9,11]. Leave empty to use trainOnly.
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

		// Re-render on a faster cadence than the data refresh so the "X min"
		// countdown stays roughly live without hammering the TfNSW API.
		setInterval(() => {
			if (this.loaded && !this.errorMessage) {
				this.updateDom(0);
			}
		}, this.config.countdownRefresh);
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
				trainOnly: this.config.trainOnly,
				excludedModes: this.config.excludedModes,
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

		this.trips.forEach((trip, index) => {
			const card = document.createElement("div");
			card.className = "train-card";

			// Left: minutes-until countdown
			const countdown = document.createElement("div");
			countdown.className = "countdown";
			const minsUntil = this.minutesUntil(trip.estimatedDeparture);
			countdown.innerHTML =
				minsUntil === null
					? ""
					: `<span class="num">${minsUntil <= 0 ? "Now" : minsUntil}</span>` +
					  (minsUntil > 0 ? `<span class="unit">min</span>` : "");
			card.appendChild(countdown);

			// Main content
			const main = document.createElement("div");
			main.className = "card-main";

			const badgeRow = document.createElement("div");
			badgeRow.className = "badge-row";
			(trip.lines || []).forEach((lineName) => {
				if (!lineName) return;
				const badge = document.createElement("span");
				badge.className = "line-badge " + this.lineBadgeClass(lineName);
				badge.innerHTML = lineName;
				badgeRow.appendChild(badge);
			});
			const routeTitle = document.createElement("span");
			routeTitle.className = "route-title bright";
			routeTitle.innerHTML = trip.destination || "";
			badgeRow.appendChild(routeTitle);
			main.appendChild(badgeRow);

			const timeRow = document.createElement("div");
			timeRow.className = "time-row";
			let timeRowHtml = this.formatTime(trip.estimatedDeparture);
			if (this.config.showDuration && trip.durationMinutes) {
				timeRowHtml += ` <span class="duration">(${trip.durationMinutes}min)</span>`;
				if (trip.arrivalTime) {
					timeRowHtml += ` &rarr; ${this.formatTime(trip.arrivalTime)}`;
				}
			}
			timeRow.innerHTML = timeRowHtml;
			main.appendChild(timeRow);

			const statusRow = document.createElement("div");
			statusRow.className = "status-row";
			let statusText = "";
			let statusCls = "on-time";
			if (this.config.showDelay) {
				if (trip.isRealtime && trip.delayMinutes > 0) {
					statusCls = trip.delayMinutes >= this.config.lateCriticalLimitMin ? "late-critical" : "late";
					statusText = trip.delayMinutes + "m late";
				} else if (trip.isRealtime) {
					statusText = "On-time";
				}
			}
			let fromText = "";
			if (trip.originStationName) {
				fromText = "from " + trip.originStationName;
				if (this.config.showPlatform && trip.platform) {
					fromText += ", Platform " + trip.platform;
				}
			} else if (this.config.showPlatform && trip.platform) {
				fromText = "Platform " + trip.platform;
			}
			let statusHtml = "";
			if (statusText) {
				statusHtml += `<span class="status-dot ${statusCls}">&#9679;</span> <span class="${statusCls}">${statusText}</span>`;
			}
			if (fromText) {
				statusHtml += (statusHtml ? " " : "") + fromText;
			}
			statusRow.innerHTML = statusHtml;
			main.appendChild(statusRow);

			card.appendChild(main);

			if (this.config.fade && this.config.fadePoint < 1) {
				let fadePoint = this.config.fadePoint;
				if (fadePoint < 0) fadePoint = 0;
				const startingPoint = this.trips.length * fadePoint;
				const steps = this.trips.length - startingPoint;
				if (index >= startingPoint) {
					const currentStep = index - startingPoint;
					card.style.opacity = 1 - (1 / steps) * currentStep;
				}
			}

			wrapper.appendChild(card);
		});

		return wrapper;
	},

	minutesUntil: function (isoString) {
		if (!isoString) return null;
		const diffMs = new Date(isoString).getTime() - Date.now();
		return Math.round(diffMs / 60000);
	},

	// Maps a line code (T1, T9, M1, ...) to a CSS class for badge colouring.
	// Falls back to a neutral colour for anything not explicitly listed.
	lineBadgeClass: function (lineName) {
		const code = (lineName || "").trim().toUpperCase();
		const known = ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "M1"];
		if (known.includes(code)) {
			return "line-" + code.toLowerCase();
		}
		return "line-default";
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
