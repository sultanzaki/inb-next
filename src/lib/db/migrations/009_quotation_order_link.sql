begin;
-- Apply after 008. Read-only relationship; no business records are changed.
create or replace function public.erp_quote_order(p_token text,p_quote uuid) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare u public.users; family uuid; result jsonb;
begin
 u:=public.erp_actor(p_token);
 perform public.erp_assert(u.id,'sales','read');
 select root_id into family from public.erp_quotes where id=p_quote;
 if not found then raise no_data_found; end if;
 select jsonb_build_object('id',id,'number',number,'state',state) into result
 from public.erp_orders where root_id=family;
 return result;
end $$;
revoke all on function public.erp_quote_order(text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.erp_quote_order(text,uuid) to service_role;
notify pgrst,'reload schema';
commit;
