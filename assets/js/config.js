/* RECKON — where the data lives.
   =============================================================================
   Fill these two in from Supabase → Project Settings → API:
     supabaseUrl      the "Project URL"            https://abcd1234.supabase.co
     supabaseAnonKey  the "anon public" API key    eyJhbGciOi…
   Both are public by design: the anon key only lets a browser do what the
   row-level security policies in supabase/schema.sql allow. Never put the
   service_role key here.

   After editing, bump ?v= on config.js in the pages (or run
   `node _dev/asset-versions.mjs` — it tells you which). */
window.TN_CONFIG = {
  supabaseUrl: 'https://hlndaxghgqnvccwkgsea.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhsbmRheGdoZ3FudmNjd2tnc2VhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE5NzAyODAsImV4cCI6MjEwNzU0NjI4MH0.ErcM9thtIl-9OsrWhMkZOZxlUO1nHcVB-G46f1ZVY-E'
};
