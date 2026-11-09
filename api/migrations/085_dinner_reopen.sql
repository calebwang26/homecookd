-- A dinner's machine (Caleb, Nov 8: decision 5; docs/agents/STATE-MACHINES.md row 11; the table is in api/src/modules/community/dinners.ts).
-- A full dinner goes back to open when a seat frees, and the team's own keep brings back a dinner it took down while the dinner is still ahead.
-- taken_down_at says the team's remove is what called it off, so a dinner its host's leaving called off is never brought back by it.
alter table dinners add column taken_down_at timestamptz;
alter table dinners add constraint dinners_taken_down check (taken_down_at is null or (status = 'cancelled' and hidden_at is not null));

-- A full dinner with a seat free (a guest's deletion took their seat before this): open again. Production and staging had no full dinner on Nov 9.
update dinners d set status = 'open'
 where d.status = 'full' and (select count(*) from dinner_requests r where r.dinner_id = d.id and r.status = 'accepted') < d.seats;
