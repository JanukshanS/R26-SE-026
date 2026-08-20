-- capture_photos is written via upsert() (lib/capture-api.ts postOriginalMedia)
-- specifically so a retry after an interrupted upload updates the existing row
-- instead of failing on the (capture_id, photo_index, asset_kind) unique
-- constraint. The original schema only granted select/insert, so any retry
-- that lands on an already-inserted row fails RLS on the update path with
-- "new row violates row-level security policy (USING expression)".

create policy capture_photos_update_own on capture_photos
  for update using (
    exists (
      select 1 from captures c
      where c.id = capture_photos.capture_id and c.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from captures c
      where c.id = capture_photos.capture_id and c.user_id = auth.uid()
    )
  );
