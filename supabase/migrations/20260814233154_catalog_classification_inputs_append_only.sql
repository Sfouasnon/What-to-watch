-- Classification evidence is append-only for the maintenance hydrator.
-- An older catalog grant included UPDATE; remove it explicitly so neither a
-- retry nor a future script regression can replace a frozen evidence packet.
revoke update, delete, truncate on table public.title_classification_inputs from service_role;

-- Preserve only the operations required by the queue-driven hydrator.
grant select, insert on table public.title_classification_inputs to service_role;
