# my-activities

Data behind https://www.arifulhasan.net/p/my-physical-activities.html

Every 6 hours (and whenever you press the Chrome button) GitHub runs `scripts/sync.js`, which:

1. downloads new activities from Strava (cycling, walking, running, swimming; private Strava activities are skipped),
2. removes the first and last 700 m of every route (privacy) and saves them in `activities.json`,
3. works out which upazilas, unions/city wards, villages and countries each GPS route passed through, and saves the totals in `coverage.json`.

Only activities with a GPS record on Strava are counted.

| File | What it is |
|---|---|
| `activities.json` | Your activities (the page's map reads this) |
| `coverage.json` | Upazilas, unions, villages, countries (the new tabs read this) |
| `cache.json`, `villages.json` | Working files, so old routes are not re-checked every time |
| `geo/` | Boundary data: geoBoundaries (Bangladesh upazilas, unions, districts), Natural Earth (countries), OpenStreetMap villages (refreshed monthly) |
| `scripts/sync.js` | The sync script |
| `scripts/get-strava-token.js` | One-time helper to get your Strava refresh token |
| `.github/workflows/sync.yml` | Runs the sync on GitHub |

## One-time setup

1. **Upload these files** to this repository (Add file → Upload files → drag in everything from the `strava-sync` folder, including the `.github` folder → Commit changes).
2. **Strava API app:** open https://www.strava.com/settings/api and create an app (Website: `https://www.arifulhasan.net`, Authorization Callback Domain: `localhost`). Note the Client ID and Client Secret.
3. **Get the refresh token:** in the `strava-sync` folder on your computer run `node scripts\get-strava-token.js`, enter the Client ID and Secret, click Authorize in the browser window that opens, and copy what it prints.
4. **Add three secrets** here: Settings → Secrets and variables → Actions → New repository secret: `STRAVA_CLIENT_ID`, `STRAVA_CLIENT_SECRET`, `STRAVA_REFRESH_TOKEN`.
5. **First run:** Actions → Sync Strava → Run workflow → tick "Re-read the whole Strava history" → Run.

After that it runs by itself.

## If syncing stops working

Open Actions → the failed run. "Strava token refresh failed" means the refresh token has expired or changed: run step 3 again and update the `STRAVA_REFRESH_TOKEN` secret.
