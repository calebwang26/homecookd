-- Every clip of the job came from the app's own camera (PR #496): the worker keeps them in the order she filmed them and never reorders them by content.
-- Older jobs and phones that don't send it stay false, so their behaviour is unchanged.
alter table jobs add column filmed_in_app boolean not null default false;
