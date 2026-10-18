begin;
select set_config('qa.admin',(select user_id::text from public.app_members where role='admin' limit 1),true);
select set_config('request.jwt.claim.sub',current_setting('qa.admin'),true);
set local role authenticated;
do $$ declare r jsonb; begin
 assert public.get_catalog_appearance()->>'active_theme'='default';
 r:=public.save_catalog_appearance('natal','Natal QA','Mensagem QA',now()+interval '1 day',now()+interval '2 days',0);
 assert r->>'active_theme'='default','Future theme activated early';
 begin perform public.save_catalog_appearance('ano_novo','','',null,now()+interval '1 day',0);raise exception 'Lost update accepted';exception when serialization_failure then null;end;
 r:=public.save_catalog_appearance('natal','','',null,now()+interval '1 day',1);
 assert r->>'active_theme'='natal','Immediate theme not active';
 begin perform public.save_catalog_appearance('natal','','',now()+interval '3 days',now()+interval '2 days',2);raise exception 'Bad dates accepted';exception when sqlstate '22023' then null;end;
 begin perform public.save_catalog_appearance('invalid','','',null,now()+interval '1 day',2);raise exception 'Bad theme accepted';exception when sqlstate '22023' then null;end;
 r:=public.save_catalog_appearance('default','','',null,null,2);assert r->>'active_theme'='default';
end $$;
reset role;
update public.catalog_appearance set theme='natal',starts_at=now()-interval '2 days',ends_at=now()-interval '1 day';
set local role anon;
do $$ begin
 assert public.get_catalog_appearance()->>'active_theme'='default','Expired theme active';
 begin update public.catalog_appearance set theme='natal';raise exception 'Anon write accepted';exception when insufficient_privilege then null;end;
 begin perform public.save_catalog_appearance('natal','','',null,now()+interval '1 day',3);raise exception 'Anon RPC accepted';exception when insufficient_privilege then null;end;
end $$;
reset role;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000099',true);
set local role authenticated;
do $$ declare n int; begin
 update public.catalog_appearance set title='Intruder';get diagnostics n=row_count;assert n=0,'Non-admin write accepted';
 begin perform public.save_catalog_appearance('natal','','',null,now()+interval '1 day',3);raise exception 'Non-admin RPC accepted';exception when insufficient_privilege then null;end;
end $$;
rollback;
select 'PASS: admin publication, scheduling, expiry, invalid dates, version conflict, anonymous and non-admin isolation' result;
