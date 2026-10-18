import {PGlite} from '@electric-sql/pglite';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url));
// Disposable in-memory PostgreSQL. Only empty schema and synthetic test records.
const db=new PGlite();
try {
  await db.exec('begin;');
  for(const f of ['tests/fixtures/finance_base_schema.sql','tests/fixtures/function_permissions.sql','tests/fixtures/table_permissions.sql','database/financial_control.sql','database/financial_entrypoints.sql','database/financial_catalog_entrypoint.sql','database/donation_one_hour.sql',...fs.readdirSync(root+'supabase/migrations').filter(f=>f.endsWith('.sql')).sort().map(f=>'supabase/migrations/'+f)]){
    await db.exec(fs.readFileSync(root+f,'utf8')); console.log('Loaded',f);
  }
  await db.exec(`
    insert into auth.sessions(id,user_id) select id,id from auth.users;
    insert into private.access_sessions(id,user_id) select id,id from auth.users;
    create or replace function auth.jwt() returns jsonb language sql stable as $f$
      select jsonb_build_object('session_id',auth.uid()) || coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb
    $f$;
  `);
  await db.exec('commit; begin;');
  const results=await db.exec(fs.readFileSync(root+'tests/financial-control.sql','utf8'));
  console.log(JSON.stringify(results.at(-1).rows));
  await db.exec('rollback;');
  for(const f of ['tests/flexible-vip.sql','tests/wardrobe-donations.sql','tests/waitlist.sql','tests/security-catalog.sql','tests/access-control.sql','tests/access-lifecycle.sql','tests/catalog-appearance.sql']){
    const results=await db.exec(fs.readFileSync(root+f,'utf8'));
    console.log(f,JSON.stringify(results.at(-1).rows));
  }
} catch(e){console.error(e.message);console.error(e.where||'');process.exitCode=1;}finally {await db.close();}
