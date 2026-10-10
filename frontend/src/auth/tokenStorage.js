// Where the JWT lives in the browser.
//
// "Remember this device" ticked   → localStorage (survives closing the browser)
// "Remember this device" unticked → sessionStorage (gone when the tab closes)
const KEY = 'rj.token';

export function getToken() {
  try {
    return localStorage.getItem(KEY) || sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setToken(token, remember) {
  clearToken();
  try {
    (remember ? localStorage : sessionStorage).setItem(KEY, token);
  } catch {
    // Storage blocked (private mode etc.) — the session just won't persist.
  }
}

export function clearToken() {
  try {
    localStorage.removeItem(KEY);
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
