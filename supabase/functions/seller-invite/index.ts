import { createClient } from 'npm:@supabase/supabase-js@2.105.0';
const origin='https://anunes3-es-max.github.io';
const headers={'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'};
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method!=='POST')return reply({error:'Método inválido.'},405);
 try{
  const url=Deno.env.get('SUPABASE_URL')!,key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,authorization=req.headers.get('Authorization')||'';
  const caller=createClient(url,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:{user},error:authError}=await caller.auth.getUser();if(authError||!user)return reply({error:'Entre novamente.'},401);
  const {error:guard}=await caller.rpc('access_control',{p_action:'admin_check'});if(guard)return reply({error:'Confirme a senha administrativa e tente novamente.'},403);
  const {slot}=await req.json();if(![1,2].includes(slot))return reply({error:'Vaga inválida.'},400);
  const {data:panel,error:panelError}=await caller.rpc('access_control',{p_action:'panel'});if(panelError)throw panelError;
  const target=panel.slots.find((s:{slot:number})=>s.slot===slot);if(!target?.email||!target?.name)return reply({error:'Salve nome e e-mail antes do convite.'},400);
  const admin=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:existing,error:lookupError}=await admin.rpc('find_seller_user',{p_email:target.email});if(lookupError)throw lookupError;
  if(target.user_id||existing){
    const {error:bindError}=await admin.rpc('bind_seller_invitation',{p_slot:slot,p_user:target.user_id||existing,p_email:target.email});if(bindError)throw bindError;
    const {error}=await admin.auth.resetPasswordForEmail(target.email,{redirectTo:'https://anunes3-es-max.github.io/tudo-tal-App/'});if(error)throw error;
  }else{
    const {data,error}=await admin.auth.admin.inviteUserByEmail(target.email,{redirectTo:'https://anunes3-es-max.github.io/tudo-tal-App/?type=invite'});
    if(error)throw error;
    const {error:bindError}=await admin.rpc('bind_seller_invitation',{p_slot:slot,p_user:data.user.id,p_email:target.email});if(bindError)throw bindError;
  }
  return reply({ok:true});
 }catch(e){return reply({error:e instanceof Error?e.message:'Não foi possível enviar o convite.'},400);}
});
