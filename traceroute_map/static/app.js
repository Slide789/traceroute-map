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
  if (ms === null || ms === undefined) return "#98a2b3";
  if (ms < 30) return "#16a34a";
  if (ms < 100) return "#d97706";
  return "#dc2626";
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

// Spread markers that share a spot so each one stays clickable.
function makeOffsetter() {
  const used = new Map();
  return function offset(lat, lon) {
    const key = `${lat.toFixed(3)},${lon.toFixed(3)}`;
    const n = used.get(key) || 0;
    used.set(key, n + 1);
    if (n === 0) return [lat, lon];
    const ring = Math.floor((n - 1) / 6);
    const angle = ((n - 1) % 6) * (Math.PI / 3) + ring * 0.5;
    const r = 0.15 * (1 + ring * 0.7);
    return [lat + r * Math.sin(angle), lon + r * Math.cos(angle)];
  };
}

// ---------- live app ----------

const PALETTE = ["#2563eb", "#db2777", "#0891b2", "#7c3aed", "#ea580c", "#059669", "#ca8a04", "#475569"];

const map = L.map("map", { worldCopyJump: true }).setView([30, 10], 2);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);

const store = { routes: new Map() };
window.traceStore = store;

let selected = null;
let colorIndex = 0;
let offset = makeOffsetter();

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
  $("#hops-title").textContent = route ? `Hops · ${route.target}` : "Hops";
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
  map.removeLayer(route.layer);
  store.routes.delete(target);
  if (selected === target) selected = store.routes.keys().next().value ?? null;
  // Rebuild offsets so remaining markers keep sensible positions next time.
  offset = makeOffsetter();
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
  const pos = offset(hop.geo.lat, hop.geo.lon);
  L.circleMarker(pos, {
    radius: 7, weight: 2, color: route.color, fillColor: rttHex(hop.avg_rtt), fillOpacity: 0.95,
  }).bindPopup(popupHtml(route.target, hop)).addTo(route.layer);
  if (route.points.length) {
    L.polyline([route.points[route.points.length - 1], pos], {
      color: route.color, weight: 3, opacity: 0.8, dashArray: route.gap ? "6 8" : null,
    }).addTo(route.layer);
  }
  route.points.push(pos);
  route.gap = false;
  fitAll();
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

$("#target").focus();
