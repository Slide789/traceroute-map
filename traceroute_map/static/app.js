"use strict";

// ---------- shared helpers (also embedded in the HTML export) ----------

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

function rttColor(ms) {
  if (ms === null || ms === undefined) return "var(--none)";
  if (ms < 30) return "var(--fast)";
  if (ms < 100) return "var(--mid)";
  return "var(--slow)";
}

function rttHex(ms) {
  if (ms === null || ms === undefined) return "#8a8a93";
  if (ms < 30) return "#1f9d62";
  if (ms < 100) return "#d9901c";
  return "#e0424a";
}

function fmtRtt(r) {
  return r === null || r === undefined ? "*" : `${r} ms`;
}

function placeText(geo) {
  if (!geo) return "";
  return [geo.city, geo.country].filter(Boolean).join(", ");
}

function popupHtml(target, hop) {
  const g = hop.geo || {};
  return `
    <strong>Hop ${hop.index}</strong> · <span class="mono">${esc(target)}</span><br>
    <span class="mono">${esc(hop.ip)}</span>${hop.hostname ? `<br>${esc(hop.hostname)}` : ""}<br>
    RTT: ${hop.rtts.map(fmtRtt).join(" / ")}<br>
    ${esc(placeText(g))}${g.asn ? `<br>${esc(g.asn)}` : ""}`;
}

// Points on a curved arc from a to b (a quadratic Bezier that bulges "upwards"),
// sampled from t = 0 to t = tEnd so it can be drawn growing. The arc's height
// grows with distance, which makes long hops look like they fly higher.
function arcLatLngs(a, b, tEnd = 1, n = 40) {
  const A = L.latLng(a), B = L.latLng(b);
  const dx = B.lng - A.lng, dy = B.lat - A.lat;
  const d = Math.hypot(dx, dy);
  if (d < 1e-6) return [A, B];
  let px = -dy / d, py = dx / d;
  if (py < 0 || (py === 0 && px < 0)) { px = -px; py = -py; }
  const h = d * 0.22;
  const cLng = (A.lng + B.lng) / 2 + px * h, cLat = (A.lat + B.lat) / 2 + py * h;
  const pts = [];
  const steps = Math.max(1, Math.ceil(n * tEnd));
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * tEnd, u = 1 - t;
    pts.push(L.latLng(u * u * A.lat + 2 * u * t * cLat + t * t * B.lat, u * u * A.lng + 2 * u * t * cLng + t * t * B.lng));
  }
  return pts;
}

// Spread markers that share a spot so each one stays clickable. The spread is
// in screen pixels and is recomputed on every zoom, so it works at any zoom level.
function makePlacer(map) {
  const entries = [];
  const SPREAD_PX = 16;

  function position(e) {
    if (e.n === 0) return e.base;
    const ring = Math.floor((e.n - 1) / 6);
    const angle = ((e.n - 1) % 6) * (Math.PI / 3) + ring * 0.5;
    const r = SPREAD_PX * (1 + ring * 0.8);
    const p = map.latLngToLayerPoint(e.base);
    return map.layerPointToLatLng(p.add([r * Math.cos(angle), r * Math.sin(angle)]));
  }

  function refresh() {
    const counts = new Map();
    for (const e of entries) {
      e.n = counts.get(e.key) || 0;
      counts.set(e.key, e.n + 1);
      e.marker.setLatLng(position(e));
    }
    for (const e of entries) {
      if (!e.line) continue;
      const a = e.prev.marker.getLatLng(), b = e.marker.getLatLng();
      e.line.setLatLngs(arcLatLngs(a, b));
      if (e.shadow) e.shadow.setLatLngs([a, b]);
    }
  }

  map.on("zoomend", refresh);

  return {
    // Register a marker at its true location; `line` (optional) is the arc to `prev`,
    // `shadow` (optional) its straight "ground" line.
    add(marker, lat, lon, owner, prev = null, line = null, shadow = null) {
      const entry = { marker, base: L.latLng(lat, lon), key: `${lat.toFixed(3)},${lon.toFixed(3)}`, owner, prev, line, shadow, n: 0 };
      entries.push(entry);
      refresh();
      return entry;
    },
    removeOwner(owner) {
      for (let i = entries.length - 1; i >= 0; i--) if (entries[i].owner === owner) entries.splice(i, 1);
      refresh();
    },
  };
}

// ---------- live app ----------

// Kobalt first, then colors that stay apart from it and from the latency colors.
const PALETTE = ["#3b5bff", "#e0457b", "#0fa3b1", "#8b5cf6", "#f08a24", "#64748b", "#c026d3", "#0e7490"];

// Dark mode uses the same OSM tiles, darkened with a CSS filter (see style.css).
const map = L.map("map", { worldCopyJump: true }).setView([30, 10], 2);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

// ---------- theme ----------

const darkQuery = matchMedia("(prefers-color-scheme: dark)");

function storedTheme() {
  try { const t = localStorage.getItem("theme"); return t === "light" || t === "dark" ? t : null; } catch { return null; }
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("#theme-toggle").setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
}

darkQuery.addEventListener("change", () => { if (!storedTheme()) applyTheme(darkQuery.matches ? "dark" : "light"); });

function toggleTheme() {
  const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  try { localStorage.setItem("theme", next); } catch { /* ignore */ }
  applyTheme(next);
}

// ---------- hop flight animation ----------

const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

// Fly a glowing "packet" along an arc from the previous hop to `to`, drawing the
// arc behind it. Resolves with { arc, shadow } (both null for the first hop or
// when the hop sits in the same place).
function flyHop(route, from, to, gap) {
  const start = from ? from.marker.getLatLng() : null;
  const km = start ? map.distance(start, to) / 1000 : 0;
  const lineOpts = { color: route.color, interactive: false };
  if (!start) return Promise.resolve({ arc: null, shadow: null });

  const shadow = L.polyline([], { ...lineOpts, weight: 2, opacity: 0.22 }).addTo(route.layer);
  const arc = L.polyline([], { ...lineOpts, weight: 3, opacity: 0.85, dashArray: gap ? "6 8" : null }).addTo(route.layer);
  const done = () => { arc.setLatLngs(arcLatLngs(from.marker.getLatLng(), to)); shadow.setLatLngs([from.marker.getLatLng(), to]); };

  if (reducedMotion.matches || km < 1) { done(); return Promise.resolve({ arc, shadow }); }

  const duration = Math.min(1800, 450 + 260 * Math.log2(1 + km / 100));
  const packet = L.circleMarker(start, {
    radius: 4, weight: 2, color: "#fff", fillColor: route.color, fillOpacity: 1, className: "packet", interactive: false,
  }).addTo(route.layer);
  packet.getElement()?.style.setProperty("filter", `drop-shadow(0 0 6px ${route.color})`);

  return new Promise((resolve) => {
    const t0 = performance.now();
    function frame(now) {
      if (route.removed) { resolve({ arc, shadow }); return; }
      const raw = Math.min(1, (now - t0) / duration);
      const t = easeInOut(raw);
      const a = from.marker.getLatLng();
      const pts = arcLatLngs(a, to, t);
      arc.setLatLngs(pts);
      // The ground point right under the packet: the Bezier's chord component is linear in t.
      shadow.setLatLngs([a, L.latLng(a.lat + (to.lat - a.lat) * t, a.lng + (to.lng - a.lng) * t)]);
      packet.setLatLng(pts[pts.length - 1]);
      packet.setRadius(4 + 12 * t * (1 - t)); // bigger at the top of the arc = "closer to the camera"
      if (raw < 1) { requestAnimationFrame(frame); return; }
      route.layer.removeLayer(packet);
      done();
      resolve({ arc, shadow });
    }
    requestAnimationFrame(frame);
  });
}

const store = { routes: new Map() };
window.traceStore = store;

let selected = null;
let colorIndex = 0;
const placer = makePlacer(map);

const $ = (sel) => document.querySelector(sel);

function statusText(route) {
  switch (route.status) {
    case "tracing": return `tracing… ${route.hops.length} hops`;
    case "reached": return `reached in ${route.hops.length} hops`;
    case "not-reached": return `target not reached (${route.hops.length} hops)`;
    default: return route.status;
  }
}

function renderRoutes() {
  const list = $("#route-list");
  list.innerHTML = "";
  if (store.routes.size === 0) {
    list.innerHTML = '<li class="empty">No traces yet.</li>';
  }
  for (const route of store.routes.values()) {
    const li = document.createElement("li");
    li.className = "route" + (route.target === selected ? " selected" : "");
    li.style.setProperty("--c", route.color);
    li.innerHTML = `
      <input type="checkbox" ${route.visible ? "checked" : ""} aria-label="Show route on map">
      <span class="dot"></span>
      <span class="name">${esc(route.target)}
        <span class="status ${route.error ? "error" : ""}">${esc(statusText(route))}</span></span>
      <button class="remove" type="button" aria-label="Remove route">×</button>`;
    li.querySelector("input").addEventListener("click", (e) => {
      e.stopPropagation();
      route.visible = e.target.checked;
      route.visible ? route.layer.addTo(map) : map.removeLayer(route.layer);
      fitAll();
    });
    li.querySelector(".remove").addEventListener("click", (e) => {
      e.stopPropagation();
      removeRoute(route.target);
    });
    li.addEventListener("click", () => { selected = route.target; renderRoutes(); renderHops(); });
    list.appendChild(li);
  }
  $("#export").disabled = ![...store.routes.values()].some((r) => r.visible && r.hops.length);
}

function renderHops() {
  const body = $("#hop-table tbody");
  body.innerHTML = "";
  const route = store.routes.get(selected);
  $("#hops-title").innerHTML = route ? `Hops<span class="count">${esc(route.target)}</span>` : "Hops";
  if (!route) return;
  for (const hop of route.hops) {
    const tr = document.createElement("tr");
    if (hop.kind === "timeout") {
      tr.className = "timeout";
      tr.innerHTML = `<td class="num">${hop.index}</td><td colspan="3">* * * no reply</td>`;
    } else {
      const g = hop.geo;
      const where = hop.kind === "private"
        ? '<span class="tag">private network</span>'
        : g ? `${esc(placeText(g))}<span class="sub">${esc(g.asn || "")}</span>` : '<span class="sub">unknown</span>';
      tr.innerHTML = `
        <td class="num">${hop.index}</td>
        <td><span class="addr">${esc(hop.ip)}</span>${hop.hostname ? `<span class="host">${esc(hop.hostname)}</span>` : ""}</td>
        <td class="rtt" style="--c:${rttColor(hop.avg_rtt)}">${fmtRtt(hop.avg_rtt)}</td>
        <td>${where}</td>`;
    }
    body.appendChild(tr);
  }
}

function fitAll() {
  const points = [];
  for (const r of store.routes.values()) {
    if (r.visible) points.push(...r.points);
  }
  if (points.length === 1) map.setView(points[0], 6);
  else if (points.length > 1) map.fitBounds(points, { padding: [40, 40], maxZoom: 8 });
}

function removeRoute(target) {
  const route = store.routes.get(target);
  if (!route) return;
  route.source?.close();
  route.removed = true;
  map.removeLayer(route.layer);
  store.routes.delete(target);
  if (selected === target) selected = store.routes.keys().next().value ?? null;
  placer.removeOwner(route);
  renderRoutes();
  renderHops();
  fitAll();
}

function addHop(route, hop) {
  route.hops.push(hop);
  if (!hop.geo) {
    if (hop.kind !== "private" || route.points.length) route.gap = true;
    return;
  }
  const pos = L.latLng(hop.geo.lat, hop.geo.lon);
  const gap = route.gap;
  route.gap = false;
  route.points.push(pos);
  fitAll();
  // Hops arrive faster than they fly, so queue the flights one after another.
  route.anim = route.anim.then(async () => {
    if (route.removed) return;
    const from = route.lastEntry;
    const { arc, shadow } = await flyHop(route, from, pos, gap);
    if (route.removed) return;
    const fill = rttHex(hop.avg_rtt);
    const marker = L.circleMarker(pos, {
      radius: 7, weight: 2, color: route.color, fillColor: fill, fillOpacity: 0.95, className: "hop-pop",
    }).bindPopup(popupHtml(route.target, hop)).addTo(route.layer);
    route.lastEntry = placer.add(marker, hop.geo.lat, hop.geo.lon, route, from, arc, shadow);
    if (!reducedMotion.matches) {
      const ripple = L.circleMarker(marker.getLatLng(), {
        radius: 7, weight: 2, color: fill, fill: false, className: "hop-ripple", interactive: false,
      }).addTo(route.layer);
      setTimeout(() => route.layer.removeLayer(ripple), 750);
    }
  });
}

function startTrace(target) {
  removeRoute(target);
  const route = {
    target,
    color: PALETTE[colorIndex++ % PALETTE.length],
    visible: true,
    status: "tracing",
    error: false,
    ip: null,
    hops: [],
    points: [],
    gap: false,
    lastEntry: null,
    anim: Promise.resolve(),
    removed: false,
    layer: L.layerGroup().addTo(map),
    source: null,
  };
  store.routes.set(target, route);
  selected = target;

  const source = new EventSource(`/api/trace?target=${encodeURIComponent(target)}`);
  route.source = source;
  source.onmessage = (msg) => {
    const ev = JSON.parse(msg.data);
    if (ev.type === "start") route.ip = ev.ip;
    else if (ev.type === "hop") addHop(route, ev.hop);
    else if (ev.type === "done") { route.status = ev.reached ? "reached" : "not-reached"; source.close(); }
    else if (ev.type === "error") { route.status = ev.message; route.error = true; source.close(); }
    renderRoutes();
    if (selected === target) renderHops();
  };
  source.onerror = () => {
    if (route.status === "tracing") { route.status = "connection lost"; route.error = true; renderRoutes(); }
    source.close();
  };
  renderRoutes();
  renderHops();
}

// Same rule as the server: plain hostname or IP, never something that looks like an option.
const TARGET_RE = /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*|[0-9a-fA-F:.]+)$/;

$("#trace-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const input = $("#target");
  const target = input.value.trim();
  $("#form-error").textContent = "";
  if (!target) return;
  if (!TARGET_RE.test(target) || target.length > 253) {
    $("#form-error").textContent = "Enter a hostname (example.com) or an IP address.";
    return;
  }
  startTrace(target);
  input.select();
});

$("#export").addEventListener("click", () => {
  if (typeof downloadExport === "function") downloadExport(store);
});

$("#theme-toggle").addEventListener("click", toggleTheme);
applyTheme(document.documentElement.dataset.theme === "dark" ? "dark" : "light");

$("#target").focus();
