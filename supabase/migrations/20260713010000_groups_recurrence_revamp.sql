-- Groups recurrence revamp: fixed calendar anchors, pause/resume, and an
-- advance reminder before a recurring group's next capsule is auto-created.
-- See docs/superpowers/specs/2026-07-13-groups-recurrence-revamp-design.md.

alter table public.groups
  add column anchor_weekday smallint,
  add column anchor_day_of_month smallint,
  add column anchor_month smallint,
  add column anchor_day smallint,
  add column anchor_hour smallint,
  add column anchor_minute smallint,
  add column recurrence_paused_at timestamptz,
  add column reminder_lead_hours smallint,
  add column next_reminder_sent_at timestamptz;

-- Backfill every existing group's anchor from its CURRENT next_capsule_at,
-- so no group's actual next-fire date changes as a result of this migration
-- — only new metadata is added.
update public.groups set
  anchor_weekday = extract(dow from next_capsule_at)::smallint,
  anchor_hour = extract(hour from next_capsule_at)::smallint,
  anchor_minute = extract(minute from next_capsule_at)::smallint
where recurrence_interval = 'weekly' and next_capsule_at is not null;

update public.groups set
  anchor_day_of_month = extract(day from next_capsule_at)::smallint,
  anchor_hour = extract(hour from next_capsule_at)::smallint,
  anchor_minute = extract(minute from next_capsule_at)::smallint
where recurrence_interval = 'monthly' and next_capsule_at is not null;

update public.groups set
  anchor_month = extract(month from next_capsule_at)::smallint,
  anchor_day = extract(day from next_capsule_at)::smallint,
  anchor_hour = extract(hour from next_capsule_at)::smallint,
  anchor_minute = extract(minute from next_capsule_at)::smallint
where recurrence_interval = 'yearly' and next_capsule_at is not null;

update public.groups set reminder_lead_hours = 24
where recurrence_interval <> 'manual';

-- Constraints added AFTER backfill so they validate real (now-populated)
-- data rather than rejecting pre-existing rows against nulls.
alter table public.groups
  add constraint groups_anchor_weekday_check
    check (recurrence_interval <> 'weekly' or anchor_weekday between 0 and 6),
  add constraint groups_anchor_day_of_month_check
    check (recurrence_interval <> 'monthly' or anchor_day_of_month between 1 and 31),
  add constraint groups_anchor_yearly_check
    check (recurrence_interval <> 'yearly' or (anchor_month between 1 and 12 and anchor_day between 1 and 31)),
  add constraint groups_anchor_time_check
    check (recurrence_interval = 'manual' or (anchor_hour between 0 and 23 and anchor_minute between 0 and 59)),
  add constraint groups_reminder_lead_hours_check
    check (reminder_lead_hours is null or reminder_lead_hours between 1 and 720);

-- notifications: group_id (nullable — populated only for
-- group_capsule_upcoming, which has no capsule yet) and the new type.
alter table public.notifications
  add column group_id uuid references public.groups(id) on delete cascade;

alter table public.notifications drop constraint notifications_type_check;
alter table public.notifications add constraint notifications_type_check
  check (type = any (array[
    'invite', 'unlock', 'contribution_nudge', 'milestone', 'reaction',
    'superlative_suggested', 'superlative_closing_soon', 'superlative_won',
    'friend_request', 'friend_accept', 'unlock_reminder', 'group_capsule',
    'group_capsule_upcoming'
  ]));
