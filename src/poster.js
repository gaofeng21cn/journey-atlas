/* Renders the static flight-passport poster. */
(function () {
  "use strict";

  const DATA = window.FLIGHT_DATA;
  const DOTS = window.WORLD_DOTS || [];
  const SVG_NS = "http://www.w3.org/2000/svg";

  const VB_W = 1000;
  const VB_H = 372;
  const LAT_TOP = 76;
  const LAT_BOTTOM = -46;

  const project = (lat, lon) => [
    ((lon + 180) / 360) * VB_W,
    ((LAT_TOP - lat) / (LAT_TOP - LAT_BOTTOM)) * VB_H,
  ];

  /* Arc height follows how far apart the two airports are drawn on the plate,
     which is what mainstream flight trackers look like: a domestic hop stays
     almost straight, a medium leg bends gently, and an intercontinental route
     sweeps across the whole map. Scaling by kilometres instead would either
     balloon short legs or flatten long ones. */
  const sagitta = (len) => Math.min(len * 0.14, 100);

  const el = (tag, attrs) => {
    const node = document.createElementNS(SVG_NS, tag);
    for (const k in attrs) node.setAttribute(k, attrs[k]);
    return node;
  };

  const fmt = (n) => n.toLocaleString("en-US");
  const visitedCountries = new Set(DATA.countries.map((c) => c.name));

  /* dots */
  const dotsGroup = document.getElementById("mapDots");
  const dotFrag = document.createDocumentFragment();
  DOTS.forEach(([lon, lat, country]) => {
    const [x, y] = project(lat, lon);
    const visited = visitedCountries.has(country);
    dotFrag.appendChild(el("circle", { class: "map__dot" + (visited ? " map__dot--visited" : ""), cx: x.toFixed(1), cy: y.toFixed(1), r: 1.2 }));
  });
  dotsGroup.appendChild(dotFrag);

  /* arcs */
  const arcsGroup = document.getElementById("mapArcs");
  const arcFrag = document.createDocumentFragment();
  // Same city pair, opposite direction, is a round trip rather than a
  // duplicate. Keys are endpoint-ordered so the return leg is actually
  // recognised; a nested dashed arc keeps both directions visible.
  const endpointKey = (p) => p.map((n) => n.toFixed(1)).join(",");
  const drawnDirections = new Set();
  const drawnPairs = new Set();
  DATA.arcs.forEach((arc) => {
    const a = project(arc.a[0], arc.a[1]);
    const b = project(arc.b[0], arc.b[1]);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len = Math.hypot(dx, dy);
    if (!len) { return; }
    let perp = len === 0 ? [0, -1] : [-dy / len, dx / len];
    // Every arc bows toward the north side of the plate, so the network keeps
    // one readable flow instead of crossing itself.
    if (perp[1] > 0) { perp = [-perp[0], -perp[1]]; }
    const from = endpointKey(a), to = endpointKey(b);
    const direction = from + ">" + to;
    if (drawnDirections.has(direction)) { return; }
    drawnDirections.add(direction);
    const pair = from < to ? from + "|" + to : to + "|" + from;
    const isReturn = drawnPairs.has(pair);
    drawnPairs.add(pair);
    // A round trip is drawn as a symmetric lens: the outbound bows to one side
    // of the straight line and the return to the other. Both directions are
    // solid, so nothing needs a legend to explain a dashed style.
    const side = isReturn ? -1 : 1;
    const height = sagitta(len);
    // A quadratic curve reaches half its control offset, so the control point
    // is placed at twice the intended height.
    const cx = (a[0] + b[0]) / 2 + perp[0] * height * side * 2;
    const cy = (a[1] + b[1]) / 2 + perp[1] * height * side * 2;
    arcFrag.appendChild(
      el("path", {
        class:
          "map__arc" +
          (arc.km >= 4000 ? " map__arc--long" : "") +
          (isReturn ? " map__arc--return" : ""),
        d: `M${a[0].toFixed(1)},${a[1].toFixed(1)} Q${cx.toFixed(1)},${cy.toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}`,
      })
    );
  });
  arcsGroup.appendChild(arcFrag);

  /* nodes */
  const nodesGroup = document.getElementById("mapNodes");
  const maxN = Math.max(...DATA.airportPoints.map((p) => p.n));
  DATA.airportPoints.forEach((ap) => {
    const [x, y] = project(ap.lat, ap.lon);
    const r = 2.1 + Math.sqrt(ap.n / maxN) * 2.1;
    const kind = ap.n >= 15 ? " map-node--hub" : "";
    nodesGroup.appendChild(el("circle", { class: "map-node" + kind, cx: x.toFixed(1), cy: y.toFixed(1), r: r.toFixed(1) }));
  });

  /* stamps */
  const stamps = document.getElementById("stamps");
  DATA.countries.forEach((c) => {
    const li = document.createElement("li");
    li.className = "stamp";
    li.innerHTML = `<span class="stamp__flag">${c.flag || "🌐"}</span>${c.name}`;
    stamps.appendChild(li);
  });

  const m = DATA.meta;
  const totalFlights = m.flightCount + m.plannedCount;
  const totalHours = Math.round(m.totalMinutes / 60);
  const stats = {
    flights: totalFlights, distance: fmt(m.totalKm),
    years: `${m.firstYear} — ${m.lastYear}`, countries: m.countries,
    cities: m.cities, airports: m.airports, airlines: m.airlines,
    earth: (m.totalKm / m.earthKm).toFixed(1),
    totalHours: fmt(totalHours),
  };
  document.querySelectorAll("[data-stat]").forEach((node) => {
    node.textContent = stats[node.dataset.stat];
  });
  document.getElementById("machineStats").textContent =
    `${m.firstYear}<<${m.lastYear}<<${totalFlights}FLIGHTS<<${m.countries}COUNTRIES<<<<<<<<`;
})();
