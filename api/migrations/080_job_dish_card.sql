-- 080: the request card a recording answers (docs/build/V2-LINKING.md §1.4: the request screen passes its card to the job), so the card's kid hears "Mom filmed her
-- braised pork" once the recipe is ready (messages/pushEvents.ts). Only her own request's card is kept (jobs/service.ts). A card deleted later leaves the job be.
-- No table has real rows yet, so the plain index blocks no one.
alter table jobs add column dish_ask_id text references dish_asks (id) on delete set null;
create index jobs_dish_ask on jobs (dish_ask_id) where dish_ask_id is not null;
