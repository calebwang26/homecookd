-- When the cook answered "share the stories and tips?" on the recipe itself (POST /v1/recipes/:id/memories-opt-in). Her answer there is
-- always her latest: the recipe card exists only once her video is sent, after the recording's answer. So a publish (the worker's
-- finish, which can run long after) never overwrites it with the recording's (Caleb, Nov 8: decision 2; docs/agents/STATE-MACHINES.md #3).
alter table recipes add column memories_opt_in_at timestamptz;
