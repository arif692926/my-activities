// Strava → activities.json + coverage.json for arifulhasan.net/p/my-physical-activities.html
// Runs in GitHub Actions (Node 20+, no packages needed). Also runs locally: node scripts/sync.js
//
// Environment:
//   STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, STRAVA_REFRESH_TOKEN  – from your Strava API app (repository secrets)
//   FULL_SYNC=1    – re-read your whole Strava history instead of only recent activities
//   NO_STRAVA=1    – skip Strava and only recompute coverage from the existing activities.json
//   LIMIT=n        – (testing) only compute coverage for n new activities
'use strict';
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..');
const P = f => path.join(ROOT, f);
const HIDE_ENDS_M = 700;        // privacy: metres removed from the start and end of every published route
const VILLAGE_RADIUS_M = 400;   // a village counts when its centre point is within this distance of your route
const CACHE_VERSION = 3;
const MIN_FOREIGN_POINTS = 3;   // a foreign country needs at least this many route samples (~1 km) inside it
const GEO = {
  upazila: { file: 'geo/bgd_upazila.geojson', url: 'https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/BGD/ADM3/geoBoundaries-BGD-ADM3_simplified.geojson' },
  union: { file: 'geo/bgd_union.geojson', url: 'https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/BGD/ADM4/geoBoundaries-BGD-ADM4_simplified.geojson' },
  district: { file: 'geo/bgd_district.geojson', url: 'https://github.com/wmgeolab/geoBoundaries/raw/main/releaseData/gbOpen/BGD/ADM2/geoBoundaries-BGD-ADM2_simplified.geojson' },
  country: { file: 'geo/countries.geojson', url: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_0_countries.geojson' },
};
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
const TYPE = { Ride: 'r', VirtualRide: '', EBikeRide: 'r', GravelRide: 'r', MountainBikeRide: 'r', Velomobile: 'r', Walk: 'w', Hike: 'w', Run: 'n', TrailRun: 'n', VirtualRun: '', Swim: 's' };

const sleep = ms => new Promise(r => setTimeout(r, ms));
const readJSON = (f, d) => { try { return JSON.parse(fs.readFileSync(P(f), 'utf8')); } catch { return d; } };
const writeJSON = (f, o) => fs.writeFileSync(P(f), JSON.stringify(o));
const log = (...a) => console.log(...a);

// ---------- polyline + geometry ----------
function decode(s) { let i = 0, la = 0, lo = 0; const out = []; while (i < s.length) { let b, sh = 0, r = 0; do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); la += (r & 1) ? ~(r >> 1) : (r >> 1); sh = 0; r = 0; do { b = s.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); lo += (r & 1) ? ~(r >> 1) : (r >> 1); out.push([la / 1e5, lo / 1e5]); } return out; }
function encode(pts) { let pla = 0, plo = 0, s = ''; const enc = v => { v = v < 0 ? ~(v << 1) : v << 1; let o = ''; while (v >= 0x20) { o += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return o + String.fromCharCode(v + 63); }; for (const [la, lo] of pts) { const a = Math.round(la * 1e5), b = Math.round(lo * 1e5); s += enc(a - pla) + enc(b - plo); pla = a; plo = b; } return s; }
function dist(a, b) { const R = 6371000, r = Math.PI / 180, x = (b[0] - a[0]) * r, y = (b[1] - a[1]) * r, h = Math.sin(x / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(y / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); }
function trimEnds(pts, m) {
  if (pts.length < 2) return [];
  let total = 0; for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  if (total < 2 * m + 200) return [];
  let s = 0, a = 0; while (a < pts.length - 1 && s < m) { s += dist(pts[a], pts[a + 1]); a++; }
  let e = 0, b = pts.length - 1; while (b > a && e < m) { e += dist(pts[b], pts[b - 1]); b--; }
  return pts.slice(a, b + 1);
}
function densify(pts, step) { const out = []; for (let i = 0; i < pts.length; i++) { if (i) { const d = dist(pts[i - 1], pts[i]), n = Math.floor(d / step); for (let k = 1; k < n; k++) { const f = k / n; out.push([pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]); } } out.push(pts[i]); } return out; }
function sample(pts, step) { const out = [pts[0]]; let acc = 0; for (let i = 1; i < pts.length; i++) { acc += dist(pts[i - 1], pts[i]); if (acc >= step) { out.push(pts[i]); acc = 0; } } if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]); return out; }
function ringHas(ring, x, y) { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1]; if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) c = !c; } return c; }
function polyHas(poly, x, y) { if (!ringHas(poly[0], x, y)) return false; for (let k = 1; k < poly.length; k++) if (ringHas(poly[k], x, y)) return false; return true; }
function prepare(fc, nameOf) {
  return fc.features.map(f => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let x0 = 180, y0 = 90, x1 = -180, y1 = -90; polys.forEach(p => p[0].forEach(([x, y]) => { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }));
    return { name: nameOf(f.properties), props: f.properties, polys, bb: [x0, y0, x1, y1] };
  });
}
function locate(list, lat, lon) { for (const f of list) { if (lon < f.bb[0] || lon > f.bb[2] || lat < f.bb[1] || lat > f.bb[3]) continue; if (f.polys.some(p => polyHas(p, lon, lat))) return f; } return null; }

async function loadGeo(key) {
  const g = GEO[key];
  if (!fs.existsSync(P(g.file))) {
    fs.mkdirSync(path.dirname(P(g.file)), { recursive: true });
    log('downloading', g.url);
    const r = await fetch(g.url); if (!r.ok) throw new Error('download failed ' + g.url + ' ' + r.status);
    fs.writeFileSync(P(g.file), Buffer.from(await r.arrayBuffer()));
  }
  return JSON.parse(fs.readFileSync(P(g.file), 'utf8'));
}

// ---------- Strava ----------
async function strava(existing) {
  const { STRAVA_CLIENT_ID: id, STRAVA_CLIENT_SECRET: secret, STRAVA_REFRESH_TOKEN: refresh } = process.env;
  if (!id || !secret || !refresh) { log('Strava secrets not set – skipping Strava download.'); return []; }
  const tok = await fetch('https://www.strava.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: id, client_secret: secret, grant_type: 'refresh_token', refresh_token: refresh }) }).then(r => r.json());
  if (!tok.access_token) throw new Error('Strava token refresh failed: ' + JSON.stringify(tok).slice(0, 200));
  if (tok.refresh_token && tok.refresh_token !== refresh) log('NOTE: Strava issued a new refresh token. Update the STRAVA_REFRESH_TOKEN secret if syncing starts to fail.');
  const latest = existing.filter(x => x.src !== 'manual').map(x => x.d).sort().pop();
  const after = process.env.FULL_SYNC === '1' || !latest ? 0 : Math.floor(Date.parse(latest) / 1000) - 14 * 86400;
  const got = [];
  for (let page = 1; page < 200; page++) {
    const r = await fetch(`https://www.strava.com/api/v3/athlete/activities?per_page=200&page=${page}&after=${after}`, { headers: { Authorization: 'Bearer ' + tok.access_token } });
    if (r.status === 429) { log('Strava rate limit – waiting 15 min'); await sleep(15 * 60 * 1000); page--; continue; }
    if (!r.ok) throw new Error('Strava API ' + r.status + ' ' + (await r.text()).slice(0, 200));
    const batch = await r.json(); if (!batch.length) break; got.push(...batch); log('Strava page', page, batch.length);
  }
  const out = [];
  for (const a of got) {
    const t = TYPE[a.sport_type] ?? TYPE[a.type];
    if (!t) continue;
    if (a.private === true && process.env.INCLUDE_PRIVATE !== '1') continue; // private Strava activities stay private
    const pts = a.map && a.map.summary_polyline ? decode(a.map.summary_polyline) : [];
    const kept = trimEnds(pts, HIDE_ENDS_M);
    out.push({ t, d: a.start_date_local.slice(0, 10), km: Math.round(a.distance / 100) / 10, id: String(a.id), l: kept.length > 1 ? encode(kept) : '' });
  }
  log('Strava activities usable:', out.length);
  return out;
}

// ---------- villages: every OpenStreetMap place=village in Bangladesh, downloaded in one request and refreshed monthly ----------
async function loadVillages() {
  const file = P('geo/bd_villages.json');
  let saved = null; try { saved = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
  if (Array.isArray(saved)) saved = { d: new Date().toISOString(), rows: saved };
  const fresh = saved && (Date.now() - Date.parse(saved.d)) < 30 * 86400000;
  if (!fresh) {
    const q = '[out:json][timeout:300];area["ISO3166-1"="BD"][admin_level=2]->.bd;node[place=village](area.bd);out body;';
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        log('downloading village list from OpenStreetMap…');
        const r = await fetch(OVERPASS[attempt % OVERPASS.length], { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'my-activities-sync/1.0 (+https://github.com/arif692926/my-activities)', 'Accept': 'application/json' }, body: new URLSearchParams({ data: q }) });
        if (!r.ok) throw new Error('overpass ' + r.status);
        const j = await r.json();
        const rows = j.elements.map(e => { const t = e.tags || {}; const bn = t['name:bn'] || (/[ঀ-৿]/.test(t.name || '') ? t.name : ''); return [e.id, +e.lat.toFixed(5), +e.lon.toFixed(5), t['name:en'] || (bn === t.name ? '' : t.name || ''), bn]; });
        if (rows.length < 1000) throw new Error('village list too small: ' + rows.length);
        fs.mkdirSync(path.dirname(file), { recursive: true }); saved = { d: new Date().toISOString(), rows }; fs.writeFileSync(file, JSON.stringify(saved)); log('villages downloaded:', rows.length); break;
      } catch (e) { log('village download failed:', e.message); await sleep(30000); }
    }
  }
  if (!saved) return null;
  const rows = saved.rows, grid = new Map();
  for (const r of rows) { const k = Math.floor(r[1] * 100) + ':' + Math.floor(r[2] * 100); (grid.get(k) || grid.set(k, []).get(k)).push(r); }
  return grid;
}
function villagesNear(grid, pts) {
  const found = new Map();
  for (const p of pts) {
    const ci = Math.floor(p[0] * 100), cj = Math.floor(p[1] * 100);
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) for (const r of grid.get((ci + di) + ':' + (cj + dj)) || []) {
      if (!found.has(String(r[0])) && dist(p, [r[1], r[2]]) <= VILLAGE_RADIUS_M) found.set(String(r[0]), { name: r[3], bn: r[4], lat: r[1], lon: r[2] });
    }
  }
  return found;
}
// ---------- main ----------
(async () => {
  const data = readJSON('activities.json', { items: [] });
  const cache = readJSON('cache.json', {});

  // 1. merge new Strava activities (by id)
  if (process.env.NO_STRAVA !== '1') {
    const fresh = await strava(data.items);
    const byId = new Map(data.items.map(x => [String(x.id), x]));
    let added = 0, changed = 0;
    for (const a of fresh) { const old = byId.get(a.id); if (!old) { data.items.push(a); added++; } else if (old.km !== a.km || old.t !== a.t || old.d !== a.d || (a.l && old.l !== a.l)) { Object.assign(old, a); changed++; } }
    data.items.sort((a, b) => b.d.localeCompare(a.d));
    log(`activities: +${added} new, ${changed} updated, ${data.items.length} total`);
  }

  // 2. coverage for activities not yet in the cache
  const upaz = prepare(await loadGeo('upazila'), p => p.shapeName);
  const dist2 = prepare(await loadGeo('district'), p => p.shapeName);
  const ctry = prepare(await loadGeo('country'), p => p.NAME || p.ADMIN);
  const unions = prepare(await loadGeo('union'), p => p.shapeName);
  // index unions by the upazila that contains them, so each lookup only checks a few dozen shapes
  const unionsIn = new Map();
  for (const un of unions) { const cx = (un.bb[0] + un.bb[2]) / 2, cy = (un.bb[1] + un.bb[3]) / 2; let host = locate(upaz, cy, cx); if (!host) { const p0 = un.polys[0][0][0]; host = locate(upaz, p0[1], p0[0]); } const key = host ? host.name : ''; (unionsIn.get(key) || unionsIn.set(key, []).get(key)).push(un); }
  const districtOf = {}; // upazila name -> district (by a point inside the upazila)
  const villages = readJSON('villages.json', {});
  const vgrid = await loadVillages();
  let todo = data.items.filter(a => a.l && (!cache[a.id] || cache[a.id].v !== CACHE_VERSION));
  if (process.env.LIMIT) todo = todo.slice(0, +process.env.LIMIT);
  log('coverage to compute:', todo.length);
  let n = 0;
  for (const a of todo) {
    const pts = densify(decode(a.l), 150);
    const u = new Set(), un = new Set(), foreign = {}; let inBD = false;
    for (const p of sample(pts, 300)) {
      const f = locate(upaz, p[0], p[1]);
      if (f) { // inside Bangladesh (accurate boundaries) – never counted as another country
        inBD = true; u.add(f.name);
        if (!districtOf[f.name]) { const d = locate(dist2, p[0], p[1]); if (d) districtOf[f.name] = d.name; }
        const uu = locate(unionsIn.get(f.name) || [], p[0], p[1]) || locate(unionsIn.get('') || [], p[0], p[1]);
        if (uu) un.add(uu.name + '|' + f.name);
        continue;
      }
      const k = locate(ctry, p[0], p[1]);
      if (k && k.props.ISO_A2_EH !== 'BD') { const key = (k.props.ISO_A2_EH && k.props.ISO_A2_EH !== '-99' ? k.props.ISO_A2_EH : 'XX') + '|' + k.name; foreign[key] = (foreign[key] || 0) + 1; }
    }
    const c = new Set(Object.entries(foreign).filter(([, n]) => n >= MIN_FOREIGN_POINTS).map(([key]) => key));
    if (inBD) c.add('BD|Bangladesh');    let v = null;
    if (vgrid) { v = []; for (const [vid, info] of villagesNear(vgrid, pts)) { villages[vid] = info; v.push(vid); } }
    cache[a.id] = { v: v === null ? 0 : CACHE_VERSION, u: [...u].map(x => x + (districtOf[x] ? '|' + districtOf[x] : '')), un: [...un], c: [...c], vi: v || [] };
    if (++n % 50 === 0) { log(`coverage ${n}/${todo.length}`); writeJSON('cache.json', cache); writeJSON('villages.json', villages); }
  }

  // 3. aggregate
  const byDate = [...data.items].sort((a, b) => a.d.localeCompare(b.d));
  const U = {}, UN = {}, V = {}, C = { r: {}, w: {}, n: {}, s: {} };
  for (const a of byDate) {
    const k = cache[a.id]; if (!k) continue;
    for (const s of k.u) { const [name, district] = s.split('|'); const o = U[name] || (U[name] = { name, district: district || '', first: a.d, n: 0, km: 0 }); o.n++; o.km += a.km; if (!o.district && district) o.district = district; }
    for (const s of k.un || []) { if (!UN[s]) { const [name, upazila] = s.split('|'); UN[s] = { name, upazila, first: a.d }; } }
    for (const vid of k.vi) { if (!V[vid] && villages[vid]) V[vid] = { ...villages[vid], first: a.d }; }
    for (const s of k.c) { const [iso, name] = s.split('|'); const o = C[a.t][name] || (C[a.t][name] = { name, iso: iso === 'XX' ? '' : iso, first: a.d, n: 0, km: 0 }); o.n++; o.km += a.km; }
  }
  const round = o => ({ ...o, km: Math.round(o.km * 10) / 10 });
  const coverage = {
    updated: new Date().toISOString(),
    note: `Upazila and country boundaries: geoBoundaries and Natural Earth. Villages: OpenStreetMap place=village within ${VILLAGE_RADIUS_M} m of a route. Start and end ${HIDE_ENDS_M} m of each route are excluded.`,
    totals: { upazilaAreas: upaz.length, unions: unions.length, districts: dist2.length, osmVillages: vgrid ? [...vgrid.values()].reduce((s, x) => s + x.length, 0) : 0 },
    upazilas: Object.values(U).map(round).sort((a, b) => a.district.localeCompare(b.district) || a.name.localeCompare(b.name)),
    unions: Object.values(UN).map(o => ({ ...o, district: (U[o.upazila] || {}).district || '' })).sort((a, b) => a.district.localeCompare(b.district) || a.upazila.localeCompare(b.upazila) || a.name.localeCompare(b.name)),
    villages: Object.values(V).sort((a, b) => a.first.localeCompare(b.first)),
    countries: Object.fromEntries(Object.entries(C).map(([t, o]) => [t, Object.values(o).map(round).sort((a, b) => a.first.localeCompare(b.first))])),
  };
  data.updated = new Date().toISOString();
  writeJSON('activities.json', data); writeJSON('cache.json', cache); writeJSON('villages.json', villages); writeJSON('coverage.json', coverage);
  log(`done: ${coverage.upazilas.length} upazilas, ${coverage.unions.length} unions, ${coverage.villages.length} villages, countries cycled ${coverage.countries.r.length}, walked ${coverage.countries.w.length}, swims ${data.items.filter(x => x.t === 's').length}`);
})().catch(e => { console.error(e); process.exit(1); });
