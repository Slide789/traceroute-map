"use strict";

// Builds a single self-contained HTML file from the visible routes.
// The shared helpers from app.js are embedded via Function.prototype.toString,
// so the exported map looks and behaves like the live one.

const EXPORT_CSS = `
  :root { --none:#98a2b3; --fast:#16a34a; --mid:#d97706; --slow:#dc2626; --line:#e4e7ec; --muted:#667085; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.45 "Segoe UI", system-ui, sans-serif; color: #16181d; background: #fff; }
  header { padding: 16px 20px; border-bottom: 1px solid var(--line); }
  h1 { margin: 0; font-size: 20px; }
  header p { margin: 4px 0 0; color: var(--muted); font-size: 12px; }
  #map { height: 60vh; }
  main { padding: 16px 20px; display: grid; gap: 24px; grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); }
  h2 { font-size: 15px; margin: 0 0 8px; display: flex; gap: 8px; align-items: center; }
  h2 i { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { text-align: left; padding: 5px 6px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--muted); font-weight: 500; }
  .mono { font-family: Consolas, ui-monospace, monospace; }
  .sub { display: block; color: var(--muted); font-size: 12px; }
  tr.timeout td { color: var(--none); }
  footer { padding: 12px 20px 24px; color: var(--muted); font-size: 12px; }
`;

function exportHtml(store) {
  const routes = [...store.routes.values()]
    .filter((r) => r.visible && r.hops.length)
    .map((r) => ({ target: r.target, color: r.color, ip: r.ip, status: r.status, hops: r.hops }));
  const created = new Date();
  const data = JSON.stringify({ created: created.toISOString(), routes }).replace(/</g, "\\u003c");
  const helpers = [esc, rttHex, fmtRtt, placeText, popupHtml, makePlacer].map(String).join("\n\n");

  const renderer = `
${helpers}

const DATA = JSON.parse(document.getElementById("data").textContent);
document.getElementById("created").textContent = new Date(DATA.created).toLocaleString();
const map = L.map("map", { worldCopyJump: true }).setView([30, 10], 2);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 18,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
const placer = makePlacer(map);
const all = [];
const main = document.querySelector("main");
for (const route of DATA.routes) {
  let last = null, lastEntry = null, gap = false;
  const rows = [];
  for (const hop of route.hops) {
    if (hop.kind === "timeout") {
      rows.push('<tr class="timeout"><td>' + hop.index + '</td><td colspan="3">* * * no reply</td></tr>');
      if (last) gap = true;
      continue;
    }
    const where = hop.kind === "private" ? "private network"
      : hop.geo ? esc(placeText(hop.geo)) + '<span class="sub">' + esc(hop.geo.asn || "") + '</span>' : "unknown";
    rows.push('<tr><td>' + hop.index + '</td><td><span class="mono">' + esc(hop.ip) + '</span>'
      + (hop.hostname ? '<span class="sub">' + esc(hop.hostname) + '</span>' : '')
      + '</td><td>' + fmtRtt(hop.avg_rtt) + '</td><td>' + where + '</td></tr>');
    if (!hop.geo) { if (last) gap = true; continue; }
    const pos = [hop.geo.lat, hop.geo.lon];
    const marker = L.circleMarker(pos, { radius: 7, weight: 2, color: route.color, fillColor: rttHex(hop.avg_rtt), fillOpacity: 0.95 })
      .bindPopup(popupHtml(route.target, hop)).addTo(map);
    const line = last ? L.polyline([last, pos], { color: route.color, weight: 3, opacity: 0.8, dashArray: gap ? "6 8" : null }).addTo(map) : null;
    lastEntry = placer.add(marker, hop.geo.lat, hop.geo.lon, route, lastEntry, line);
    last = pos; gap = false; all.push(pos);
  }
  const section = document.createElement("section");
  const status = route.status === "reached" ? "reached" : route.status === "not-reached" ? "target not reached" : route.status;
  section.innerHTML = '<h2><i style="background:' + esc(route.color) + '"></i><span class="mono">' + esc(route.target)
    + '</span><span class="sub">' + esc(route.ip || "") + ' · ' + esc(status) + '</span></h2>'
    + '<table><thead><tr><th>#</th><th>Address</th><th>RTT</th><th>Location / network</th></tr></thead><tbody>'
    + rows.join("") + '</tbody></table>';
  main.appendChild(section);
}
if (all.length > 1) map.fitBounds(all, { padding: [40, 40], maxZoom: 8 });
else if (all.length === 1) map.setView(all[0], 6);
`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Traceroute Map export</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<style>${EXPORT_CSS}</style>
</head>
<body>
<header>
  <h1>Traceroute Map</h1>
  <p>Traced from the author's PC · exported <span id="created"></span></p>
</header>
<div id="map"></div>
<main></main>
<footer>Locations are approximate (GeoIP via ip-api.com) and often show the provider's registered location, not the physical router. Made with Traceroute Map.</footer>
<script type="application/json" id="data">${data}</script>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>${renderer.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>
`;
}

function exportFilename(date = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `traceroute-map-${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}.html`;
}

function downloadExport(store) {
  const blob = new Blob([exportHtml(store)], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = exportFilename();
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
