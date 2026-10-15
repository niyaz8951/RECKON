-- Optional, one-off: removes the Library and Dictionary tables and the
-- books bucket left from before 15 Oct 2026. Run only if you want them gone;
-- the site no longer touches them either way.
drop table if exists public.lib_dict_lookups, public.lib_dict_corrections, public.lib_dict_forms, public.lib_dict_entries,
                     public.lib_notes, public.lib_progress, public.lib_books cascade;
drop policy if exists books_read on storage.objects;
drop policy if exists books_insert on storage.objects;
drop policy if exists books_update on storage.objects;
drop policy if exists books_delete on storage.objects;
delete from storage.objects where bucket_id = 'books';
delete from storage.buckets where id = 'books';
