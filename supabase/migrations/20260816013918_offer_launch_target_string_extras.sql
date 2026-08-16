-- Fire TV launcher contracts can identify content either with a URI or with a
-- scalar string extra named by the provider's DATA_EXTRA_NAME capability.

alter table public.offer_launch_targets
  alter column target_uri drop not null,
  add column data_extra_name text,
  add column data_extra_value text;

alter table public.offer_launch_targets
  drop constraint offer_launch_targets_target_kind_check,
  drop constraint offer_launch_targets_target_uri_check;

alter table public.offer_launch_targets
  add constraint offer_launch_targets_target_kind_check check (
    target_kind in ('uri', 'android_intent_uri', 'android_string_extra')
  ),
  add constraint offer_launch_targets_target_uri_check check (
    (
      target_kind in ('uri', 'android_intent_uri')
      and target_uri is not null
      and length(target_uri) between 1 and 4096
      and target_uri ~ '^(https?://|intent:|amzn://|pplus://)'
      and data_extra_name is null
      and data_extra_value is null
    )
    or
    (
      target_kind = 'android_string_extra'
      and platform in ('android_tv', 'fire_tv')
      and target_uri is null
      and package_name is not null
      and component_name is not null
      and action is not null
      and data_extra_name ~ '^[A-Za-z][A-Za-z0-9_.]{0,119}$'
      and length(data_extra_value) between 1 and 512
      and data_extra_value !~ '[[:cntrl:]]'
    )
  );
