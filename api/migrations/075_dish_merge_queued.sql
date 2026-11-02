-- 075: when a merge's message last went on the queue, so a kid's page polling every few seconds doesn't queue one each time.
alter table dish_asks add column merge_queued_at timestamptz;
