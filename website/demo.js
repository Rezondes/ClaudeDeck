// Interactive Stream Deck in the hero. Plays one session asking for permission and reacts to clicks
// the way the real keys do. All images are rendered by the plugin itself (npm run site:keys).
(() => {
	const deck = document.getElementById("demo");
	const caption = document.getElementById("caption");
	if (!deck || !caption) return;

	const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	const img = (name) => `img/keys/${name}.svg`;
	const key = (id) => deck.querySelector(`[data-key="${id}"]`);
	const timers = new Set();
	const later = (ms, fn) => {
		const t = setTimeout(() => {
			timers.delete(t);
			fn();
		}, ms);
		timers.add(t);
		return t;
	};
	const clearAll = () => {
		timers.forEach(clearTimeout);
		timers.clear();
	};

	function show(id, name, alt) {
		const el = key(id).querySelector("img");
		el.src = img(name);
		if (alt) el.alt = alt;
	}

	function say(html) {
		caption.innerHTML = html;
	}

	// Blinking keys switch between a normal and a white-framed frame every 500 ms, like the plugin.
	const blinkers = new Map();
	function blink(id, normal, flash) {
		stopBlink(id);
		show(id, normal);
		if (reduceMotion) return;
		let on = false;
		blinkers.set(
			id,
			setInterval(() => {
				on = !on;
				show(id, on ? flash : normal);
			}, 500),
		);
	}
	function stopBlink(id) {
		clearInterval(blinkers.get(id));
		blinkers.delete(id);
	}

	function press(el) {
		el.classList.add("pressed");
		setTimeout(() => el.classList.remove("pressed"), 120);
	}
	function nope(el) {
		el.classList.remove("nope");
		void el.offsetWidth;
		el.classList.add("nope");
	}

	// Session A: works, asks for permission, finishes.
	let phase = "working";

	function decisionKeys(active) {
		show("allow", active ? "demo-allow" : "allow-idle");
		show("always", active ? "demo-always" : "always-idle");
		show("deny", active ? "demo-deny" : "deny-idle");
	}

	function working() {
		phase = "working";
		stopBlink("a");
		decisionKeys(false);
		show("a", "demo-a-working", "Status: Login-Seite bauen, Working");
		say("Claude baut gerade die Login-Seite. Die Taste ganz links zeigt es dir.");
		later(1800, () => show("a", "demo-a-working-2"));
		later(3600, ask);
	}

	function ask() {
		phase = "approval";
		blink("a", "demo-a-approval", "demo-a-approval-flash");
		key("a").querySelector("img").alt = "Status: Login-Seite bauen, Approve";
		decisionKeys(true);
		say("Claude möchte <strong>npm test</strong> ausführen. Drück <strong>Allow</strong>, <strong>Always</strong> oder <strong>Deny</strong>.");
		later(9000, () => decide("allow", true));
	}

	function decide(kind, auto) {
		if (phase !== "approval") return;
		clearAll();
		phase = "continuing";
		stopBlink("a");
		decisionKeys(false);
		show("a", "demo-a-working-2", "Status: Login-Seite bauen, Working");
		const text = {
			allow: "Erlaubt, einmal. Claude arbeitet weiter.",
			always: "Erlaubt für den Rest der Session. Claude fragt dafür nicht mehr.",
			deny: "Abgelehnt. Claude sucht einen anderen Weg.",
		}[kind];
		say(auto ? `Niemand hat gedrückt, also nehmen wir Allow. ${text}` : text);
		later(2600, done);
	}

	function done() {
		phase = "done";
		show("a", "demo-a-done", "Status: Login-Seite bauen, Done");
		say("Fertig. Ein Druck auf die grüne Taste öffnet die Session in Claude Desktop.");
		later(7000, idle);
	}

	function idle(pressed) {
		clearAll();
		phase = "idle";
		show("a", "demo-a-idle", "Status: Login-Seite bauen, Idle");
		if (pressed) say("Claude Desktop springt in die Session. Die Taste wird grau, weil du es gesehen hast.");
		later(3500, working);
	}

	// Session B waits for an answer the whole time.
	blink("b", "demo-b-input", "demo-b-input-flash");
	let bTimer;

	// Plan Usage shows the reset times for 3 seconds, like the real key.
	let usageTimer;

	// Claude Window flips between maximize and minimize.
	let maximized = false;

	deck.addEventListener("click", (event) => {
		const el = event.target.closest("button.key");
		if (!el) return;
		press(el);
		const id = el.dataset.key;

		if (id === "allow" || id === "always" || id === "deny") {
			if (phase === "approval") decide(id, false);
			else {
				nope(el);
				say("Gerade gibt es nichts zu erlauben. Ohne offene Anfrage bleiben diese Tasten gedimmt.");
			}
		} else if (id === "a") {
			if (phase === "done") idle(true);
			else if (phase === "approval") say("Antworte mit <strong>Allow</strong>, <strong>Always</strong> oder <strong>Deny</strong>. Ein Druck hier öffnet die Session.");
			else say("Ein Druck öffnet die Session in Claude Desktop. Lang drücken würde die laufende Antwort abbrechen.");
		} else if (id === "b") {
			stopBlink("b");
			clearTimeout(bTimer);
			show("b", "demo-b-working", "Status: Farben wählen, Working");
			say("Claude Desktop öffnet die Session mit der Frage. Du antwortest, Claude arbeitet weiter.");
			bTimer = setTimeout(() => blink("b", "demo-b-input", "demo-b-input-flash"), 6000);
		} else if (id === "c") {
			show("c", "status-idle", "Status: README schreiben, Idle");
			say("Gesehen. Die Taste wechselt von Done auf Idle und Claude Desktop zeigt die Session.");
		} else if (id === "d") {
			say("Diese Session ruht. Ein Druck öffnet sie trotzdem.");
		} else if (id === "usage") {
			clearTimeout(usageTimer);
			show("usage", "usage-reset", "Plan Usage: Reset-Zeiten");
			say("Für drei Sekunden: wann dein 5-Stunden- und dein 7-Tage-Limit zurückgesetzt werden.");
			usageTimer = setTimeout(() => show("usage", "usage", "Plan Usage"), 3000);
		} else if (id === "window") {
			maximized = !maximized;
			show("window", maximized ? "window-minimize" : "window-maximize", `Claude Window: ${maximized ? "Minimize" : "Maximize"}`);
			say(maximized ? "Claude Desktop ist jetzt groß im Vordergrund. Nächster Druck: minimieren." : "Claude Desktop ist minimiert. Nächster Druck: maximieren.");
		} else if (id === "project") {
			say("Claude Desktop öffnet das Projekt MyApp, direkt beim Thread, der auf deine Antwort wartet.");
		} else if (id === "reload") {
			say("Alles neu eingelesen: Sessions, Projekte und Kontext. Lang drücken würde das Plugin neu starten.");
		} else if (id === "empty") {
			say("Eine freie Status-Taste. Die nächste neue Session landet hier.");
		}
	});

	// Start the story once the device is on screen, so nobody misses the first request.
	const start = () => later(1200, working);
	if ("IntersectionObserver" in window) {
		const io = new IntersectionObserver((entries) => {
			if (entries.some((e) => e.isIntersecting)) {
				io.disconnect();
				start();
			}
		});
		io.observe(deck);
	} else start();
})();
