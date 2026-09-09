// Shared Firebase setup — imported by every page.
// These values are meant to be public/embedded in client-side code (they are
// not secrets); access is controlled by Firebase Auth + your OAuth consent
// screen's test-user list, not by hiding this file.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyAIVDetWzg85bfbdvFd_kMOfGW_zdDkP3w",
  authDomain: "budget-tracker-90e44.firebaseapp.com",
  projectId: "budget-tracker-90e44",
  storageBucket: "budget-tracker-90e44.firebasestorage.app",
  messagingSenderId: "971365240881",
  appId: "1:971365240881:web:81a87461ca77d134d2c510",
};

// The OAuth Client ID from Google Cloud Console (Phase 0, step 11) — used
// to request Drive/Sheets access separately from login (see sheets-api.js).
export const GOOGLE_OAUTH_CLIENT_ID = "971365240881-d468u42hc9u1a5s0abagc0lsuj2aos43.apps.googleusercontent.com";

// Least-privilege scopes: drive.file only sees files this app itself
// creates (not your whole Drive); spreadsheets lets it read/write those.
export const GOOGLE_SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/spreadsheets";

export const SPREADSHEET_NAME = "Budget Tracker Data";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
