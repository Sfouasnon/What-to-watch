create policy offer_launch_targets_service_role_maintenance
on public.offer_launch_targets
for all
to service_role
using (true)
with check (true);
