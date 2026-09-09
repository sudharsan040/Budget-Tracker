// Handles: getting a Drive/Sheets-scoped OAuth token via Google Identity
// Services (GIS), and finding-or-creating each user's personal spreadsheet.
// No backend — every call here goes straight from the browser to Google's APIs.

import { GOOGLE_OAUTH_CLIENT_ID, GOOGLE_SCOPES, SPREADSHEET_NAME, DEFAULT_CATEGORIES } from './firebase-config.js';

let tokenClient = null;
let currentToken = null; // { access_token, expiresAt }

function ensureTokenClient() {
  if (tokenClient) return tokenClient;
  if (!window.google || !window.google.accounts) {
    throw new Error('Google Identity Services script did not load — check your internet connection and reload.');
  }
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_OAUTH_CLIENT_ID,
    scope: GOOGLE_SCOPES,
    callback: () => {}, // overridden per-call below
  });
  return tokenClient;
}

// Returns a valid access token, prompting the user to connect only if needed.
export function getAccessToken({ interactive = true } = {}) {
  return new Promise((resolve, reject) => {
    if (currentToken && currentToken.expiresAt > Date.now() + 30000) {
      resolve(currentToken.access_token);
      return;
    }
    const client = ensureTokenClient();
    client.callback = (resp) => {
      if (resp.error) {
        reject(new Error(resp.error === 'access_denied' ? 'You need to approve access to save data.' : resp.error));
        return;
      }
      currentToken = { access_token: resp.access_token, expiresAt: Date.now() + (resp.expires_in * 1000) };
      resolve(resp.access_token);
    };
    // Try silent first; if that fails to produce a token (no prior consent),
    // fall back to an interactive prompt.
    client.requestAccessToken({ prompt: interactive ? '' : 'none' });
  });
}

async function driveApi(path, opts, token) {
  const res = await fetch('https://www.googleapis.com/drive/v3' + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + token, ...(opts && opts.headers) },
  });
  if (!res.ok) throw new Error('Drive API error: ' + res.status + ' ' + (await res.text()));
  return res.json();
}

async function sheetsApi(path, opts, token) {
  const res = await fetch('https://sheets.googleapis.com/v4/spreadsheets' + path, {
    ...opts,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(opts && opts.headers) },
  });
  if (!res.ok) throw new Error('Sheets API error: ' + res.status + ' ' + (await res.text()));
  return res.json();
}

function cacheKey(uid) { return 'bt_spreadsheetId_' + uid; }

// Finds the user's existing Budget Tracker spreadsheet, or creates a new
// one (with Expenses + Budgets tabs and headers) if this is their first time.
export async function ensureSpreadsheet(token, uid) {
  const cached = localStorage.getItem(cacheKey(uid));
  if (cached) return cached;

  const q = `name='${SPREADSHEET_NAME}' and trashed=false`;
  const found = await driveApi('/files?q=' + encodeURIComponent(q) + '&fields=files(id,name)', {}, token);
  if (found.files && found.files.length) {
    const id = found.files[0].id;
    localStorage.setItem(cacheKey(uid), id);
    return id;
  }

  const created = await sheetsApi('', {
    method: 'POST',
    body: JSON.stringify({
      properties: { title: SPREADSHEET_NAME },
      sheets: [
        { properties: { title: 'Expenses' } },
        { properties: { title: 'Budgets' } },
      ],
    }),
  }, token);

  const id = created.spreadsheetId;

  await sheetsApi(`/${id}/values:batchUpdate`, {
    method: 'POST',
    body: JSON.stringify({
      valueInputOption: 'RAW',
      data: [
        { range: 'Expenses!A1:E1', values: [['Date', 'Amount', 'Category', 'Tag/Note', 'Source']] },
        { range: 'Budgets!A1:B1', values: [['Category', 'Monthly Limit']] },
        // Seed with sensible defaults so the "Add expense" form and Settings
        // page aren't empty on a brand-new sheet. Blank limit = no budget set.
        { range: 'Budgets!A2:B' + (DEFAULT_CATEGORIES.length + 1), values: DEFAULT_CATEGORIES.map(c => [c, '']) },
      ],
    }),
  }, token);

  localStorage.setItem(cacheKey(uid), id);
  return id;
}

export function spreadsheetUrl(id) {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

// Appends one row to Expenses (entry method #1: directly in the app).
export async function appendExpense(token, spreadsheetId, { date, amount, category, tag, source }) {
  await sheetsApi(
    `/${spreadsheetId}/values/Expenses!A:E:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`,
    { method: 'POST', body: JSON.stringify({ values: [[date, amount, category, tag || '', source || 'web-app']] }) },
    token
  );
}

// Categories live in the Budgets tab (Category | Monthly Limit) — a
// category with a blank limit simply has no budget set yet.
export async function readCategories(token, spreadsheetId) {
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Budgets!A2:B1000`,
    { headers: { Authorization: 'Bearer ' + token } }
  );
  if (!res.ok) throw new Error('Could not read categories: ' + res.status);
  const data = await res.json();
  return (data.values || []).filter(r => r[0]).map(r => ({ category: r[0], limit: r[1] || '' }));
}

// Replaces the whole category/budget list (clear then rewrite) so deletes
// and reorders in Settings are reflected cleanly.
export async function writeCategories(token, spreadsheetId, rows) {
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Budgets!A2:B1000:clear`,
    { method: 'POST', headers: { Authorization: 'Bearer ' + token } }
  );
  if (!rows.length) return;
  const values = rows.map(r => [r.category, r.limit === '' || r.limit == null ? '' : r.limit]);
  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Budgets!A2:B${rows.length + 1}?valueInputOption=RAW`,
    { method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ values }) }
  );
  if (!res.ok) throw new Error('Could not save categories: ' + res.status);
}
