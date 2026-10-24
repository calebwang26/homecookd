-- "Show Grandma yours" (Oct 18). After "I made it", the person who cooked can send the cook a photo
-- of their own bowl: the app asks POST /photo-upload for a signed upload URL into the private
-- `photos` bucket, PUTs the picture, then sends a `cooked` message with `photo_path`. Messages come
-- back with a fresh 1-hour signed `photo_url`, like voice notes; nothing in the bucket is public.
--
-- Apply BEFORE deploying the api function that has /photo-upload: it reads `messages.photo_path`
-- on every message list. Additive.

alter table public.messages add column if not exists photo_path text;

-- Private bucket for photos of dishes people made. Path: <family_id>/<uuid>.<ext>. Uploads go
-- through signed URLs; reads through signed URLs made by the api function.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('photos', 'photos', false, 10485760,
        array['image/jpeg', 'image/png', 'image/heic', 'image/webp'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;
