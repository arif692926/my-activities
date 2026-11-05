// One-time helper: gets the Strava refresh token that the sync needs.
// Run on your own computer:  node get-strava-token.js
// It asks for your Strava API app's Client ID and Client Secret, opens Strava in your browser
// so you can click "Authorize", and then prints the refresh token. Nothing is sent anywhere else.
'use strict';
const http = require('http'), readline = require('readline'), { exec } = require('child_process');
const ask = q => new Promise(r => { const rl = readline.createInterface({ input: process.stdin, output: process.stdout }); rl.question(q, a => { rl.close(); r(a.trim()); }); });

(async () => {
  console.log('\nStrava → open https://www.strava.com/settings/api (create an app if you have none;');
  console.log('set "Authorization Callback Domain" to: localhost).\n');
  const id = await ask('Client ID: ');
  const secret = await ask('Client Secret: ');
  const port = 8723, redirect = `http://localhost:${port}/callback`;
  const url = `https://www.strava.com/oauth/authorize?client_id=${encodeURIComponent(id)}&response_type=code&redirect_uri=${encodeURIComponent(redirect)}&approval_prompt=force&scope=read,activity:read`;
  const server = http.createServer(async (req, res) => {
    const u = new URL(req.url, redirect);
    if (u.pathname !== '/callback') { res.end(); return; }
    const code = u.searchParams.get('code');
    if (!code) { res.end('No code received – did you click Authorize?'); return; }
    res.end('Done. You can close this tab and go back to the command window.');
    server.close();
    const tok = await fetch('https://www.strava.com/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: id, client_secret: secret, code, grant_type: 'authorization_code' }) }).then(r => r.json());
    if (!tok.refresh_token) { console.log('\nStrava did not return a token:', JSON.stringify(tok)); process.exit(1); }
    console.log('\nAdd these three secrets to GitHub (my-activities → Settings → Secrets and variables → Actions → New repository secret):\n');
    console.log('  STRAVA_CLIENT_ID      =', id);
    console.log('  STRAVA_CLIENT_SECRET  = (the Client Secret you typed above)');
    console.log('  STRAVA_REFRESH_TOKEN  =', tok.refresh_token);
    console.log('\nKeep these private. Close this window when done.');
  }).listen(port, () => {
    console.log('\nOpening Strava in your browser. Click "Authorize".\nIf nothing opens, paste this into your browser:\n' + url + '\n');
    exec((process.platform === 'win32' ? 'start "" ' : process.platform === 'darwin' ? 'open ' : 'xdg-open ') + JSON.stringify(url));
  });
})();
