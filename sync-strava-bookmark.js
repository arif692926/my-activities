// "Sync Strava" bookmark for arifulhasan.net – click it while you are on strava.com (logged in).
// Reads your Strava activities from the Strava website, adds the new ones to
// github.com/arif692926/my-activities/activities.json, and GitHub then updates the page.
(async () => {
  const REPO = 'arif692926/my-activities', FILE = 'activities.json', KEY = 'ahActivitiesGithubToken';
  const HIDE = 700; // metres hidden at the start and end of every route
  const TYPE = { Ride: 'r', EBikeRide: 'r', GravelRide: 'r', MountainBikeRide: 'r', Velomobile: 'r', Walk: 'w', Hike: 'w', Run: 'n', TrailRun: 'n', Swim: 's' };
  if (!/(^|\.)strava\.com$/.test(location.hostname)) { alert('Open strava.com (logged in), then click "Sync Strava" again.'); location.href = 'https://www.strava.com/dashboard'; return; }
  if (window.__ahSync) return; window.__ahSync = true;
  const box = document.createElement('div');
  box.style.cssText = 'position:fixed;z-index:2147483647;top:16px;right:16px;width:320px;background:#fff;color:#111;border:2px solid #c8102e;border-radius:10px;padding:14px 16px;font:14px/1.4 system-ui,Segoe UI,Arial,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.25)';
  box.innerHTML = '<b style="color:#c8102e">Sync Strava → arifulhasan.net</b><div id="ahs-msg" style="margin-top:6px">Starting…</div>';
  document.body.appendChild(box);
  const say = (t, done) => { box.querySelector('#ahs-msg').innerHTML = t + (done ? '<div style="margin-top:8px;text-align:right"><a href="#" id="ahs-x" style="color:#c8102e">Close</a></div>' : ''); if (done) { box.querySelector('#ahs-x').onclick = e => { e.preventDefault(); box.remove(); window.__ahSync = false; }; } };
  try {
    let token = localStorage.getItem(KEY);
    if (!token) {
      token = (prompt('First time only: paste your GitHub token for arif692926/my-activities (Contents: Read and write).\nIt is saved only in this browser.') || '').trim();
      if (!token) { say('No token entered – nothing was changed.', true); return; }
      localStorage.setItem(KEY, token);
    }
    const gh = (p, o = {}) => fetch('https://api.github.com/repos/' + REPO + p, { ...o, headers: { Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', ...(o.headers || {}) } });

    // 1. current data on GitHub
    say('Reading your page data from GitHub…');
    const cur = await gh('/contents/' + FILE + '?ref=main');
    if (cur.status === 401 || cur.status === 403 || cur.status === 404) { localStorage.removeItem(KEY); say('GitHub did not accept the token (' + cur.status + '). Click the bookmark again and paste a valid token.', true); return; }
    const curJ = await cur.json();
    const bin = atob(curJ.content.replace(/\n/g, '')), bytes = Uint8Array.from(bin, c => c.charCodeAt(0));
    const data = JSON.parse(new TextDecoder().decode(bytes));
    const known = new Set(data.items.map(x => String(x.id)));

    // 2. activity list from strava.com (newest first) until a page has nothing new
    const H = { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json, text/javascript, */*; q=0.01' };
    const fresh = [];
    for (let page = 1; page < 500; page++) {
      say('Checking Strava, page ' + page + '…');
      const r = await fetch('/athlete/training_activities?keywords=&activity_type=&workout_type=&commute=&private_activities=&trainer=&gear=&search_session_id=&new_activity_only=false&page=' + page, { headers: H, credentials: 'include' });
      if (!r.ok) throw new Error('Strava list ' + r.status + ' – are you logged in?');
      const j = await r.json(), models = j.models || [];
      if (!models.length) break;
      const unseen = models.filter(m => !known.has(String(m.id)));
      fresh.push(...unseen);
      if (!unseen.length && page > 1) break;
      if (page * (j.perPage || 20) >= (j.total || 0)) break;
    }

    // 3. routes for the new activities
    const dist = (a, b) => { const R = 6371000, r = Math.PI / 180, x = (b[0] - a[0]) * r, y = (b[1] - a[1]) * r, h = Math.sin(x / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(y / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
    const trim = (p, m) => { if (p.length < 2) return []; let t = 0; for (let i = 1; i < p.length; i++) t += dist(p[i - 1], p[i]); if (t < 2 * m + 200) return []; let s = 0, a = 0; while (a < p.length - 1 && s < m) { s += dist(p[a], p[a + 1]); a++; } let e = 0, b = p.length - 1; while (b > a && e < m) { e += dist(p[b], p[b - 1]); b--; } return p.slice(a, b + 1); };
    const simplify = (p, tol) => { if (p.length < 3) return p; const keep = new Uint8Array(p.length); keep[0] = keep[p.length - 1] = 1; const st = [[0, p.length - 1]]; const k = Math.cos(p[0][0] * Math.PI / 180) * 111320; while (st.length) { const [i, j] = st.pop(); const ax = p[i][1] * k, ay = p[i][0] * 110540, bx = p[j][1] * k, by = p[j][0] * 110540, dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; let md = 0, mi = -1; for (let q = i + 1; q < j; q++) { const px = p[q][1] * k, py = p[q][0] * 110540; let t = L ? ((px - ax) * dx + (py - ay) * dy) / L : 0; t = Math.max(0, Math.min(1, t)); const ex = ax + t * dx - px, ey = ay + t * dy - py, d = ex * ex + ey * ey; if (d > md) { md = d; mi = q; } } if (mi > 0 && md > tol * tol) { keep[mi] = 1; st.push([i, mi], [mi, j]); } } return p.filter((_, q) => keep[q]); };
    const encode = pts => { let pla = 0, plo = 0, s = ''; const enc = v => { v = v < 0 ? ~(v << 1) : v << 1; let o = ''; while (v >= 0x20) { o += String.fromCharCode((0x20 | (v & 0x1f)) + 63); v >>= 5; } return o + String.fromCharCode(v + 63); }; for (const [la, lo] of pts) { const a = Math.round(la * 1e5), b = Math.round(lo * 1e5); s += enc(a - pla) + enc(b - plo); pla = a; plo = b; } return s; };

    const added = [];
    for (let i = 0; i < fresh.length; i++) {
      const m = fresh[i], t = TYPE[m.sport_type];
      if (!t || m.private || m.visibility === 'only_me') continue; // other sports, and activities you keep private, are skipped
      say('Adding ' + (i + 1) + ' of ' + fresh.length + ': ' + (m.name || '').replace(/</g, '&lt;'));
      let l = '';
      if (m.has_latlng) {
        const r = await fetch('/activities/' + m.id + '/streams?stream_types%5B%5D=latlng', { headers: H, credentials: 'include' });
        if (r.ok) { const s = await r.json(); const pts = trim(s.latlng || [], HIDE); if (pts.length > 1) l = encode(simplify(pts, 20)); }
        await new Promise(res => setTimeout(res, 400));
      }
      added.push({ t, d: new Date(m.start_date_local_raw * 1000).toISOString().slice(0, 10), km: Math.round(m.distance_raw / 100) / 10, id: String(m.id), l });
    }
    if (!added.length) { say('Your page is already up to date. Nothing new on Strava.', true); return; }

    // 4. save to GitHub
    say('Saving ' + added.length + ' new activit' + (added.length > 1 ? 'ies' : 'y') + ' to GitHub…');
    data.items.push(...added);
    data.items.sort((a, b) => b.d.localeCompare(a.d));
    data.updated = new Date().toISOString();
    const out = new TextEncoder().encode(JSON.stringify(data));
    let b64 = ''; for (let i = 0; i < out.length; i += 0x8000) b64 += String.fromCharCode.apply(null, out.subarray(i, i + 0x8000));
    const put = await gh('/contents/' + FILE, { method: 'PUT', body: JSON.stringify({ message: 'Sync from Strava (' + added.length + ' new)', content: btoa(b64), sha: curJ.sha, branch: 'main' }) });
    if (!put.ok) throw new Error('GitHub save failed (' + put.status + ')');
    const kinds = { r: 'ride', w: 'walk', n: 'run', s: 'swim' }, c = {};
    added.forEach(a => c[a.t] = (c[a.t] || 0) + 1);
    say('Done! Added ' + Object.entries(c).map(([k, n]) => n + ' ' + kinds[k] + (n > 1 ? 's' : '')).join(', ') + '.<br>The page updates in 1–2 minutes: <a href="https://www.arifulhasan.net/p/my-physical-activities.html" target="_blank" style="color:#c8102e">open it</a>.', true);
  } catch (e) {
    say('Something went wrong: ' + String(e.message || e).replace(/</g, '&lt;') + '<br>Nothing was changed. Try again later.', true);
  }
})();
