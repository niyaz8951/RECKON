/* For page tests that keep an in-memory fake of the API (written as a
   fetch(url, opts) → { ok, status, json() } function): installs it where
   global.js now sends every /api/ call — window.TNData.handle — so the
   page code runs exactly as in the browser. Route-level behaviour against
   real Postgres is tested separately (kept-data, spent-data, decided-data). */
export function installApi(window, fakeFetch) {
  window.TNData = {
    async handle(method, path, body) {
      const res = await fakeFetch(path, { method, body: body === undefined || body === null ? undefined : JSON.stringify(body) });
      const json = await res.json();
      if (!res.ok) { const e = new Error((json && json.error) || 'Request failed (' + res.status + ')'); e.status = res.status; if (json && json.signedOut) e.signedOut = true; throw e; }
      return json;
    },
    auth: { signOut: async () => {} }
  };
}
