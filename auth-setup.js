"use strict";

const SUPABASE_URL="https://iugryzipeqbgoplwqdqn.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_PbXYTHU7fS3VlkcrnvkwLQ_5A5JHwIR";
let authClient=null;

function authStatus(message,type="info"){
  const el=document.querySelector("#authStatus");
  if(!el)return;
  el.textContent=message;
  el.dataset.type=type;
}
function setAuthBusy(busy){
  document.querySelectorAll("#authGate button,#authGate input").forEach(el=>el.disabled=!!busy);
}
async function getAdminMembership(){
  const {data:{user},error:userError}=await authClient.auth.getUser();
  if(userError||!user)return {user:null,member:null};
  const {data,error}=await authClient
    .from("app_members")
    .select("user_id,role,active")
    .eq("user_id",user.id)
    .maybeSingle();
  if(error)return {user,member:null,error};
  return {user,member:data||null};
}
async function verifyAdminAndUnlock(){
  if(!authClient)return false;
  const {user,member}=await getAdminMembership();
  if(user&&member?.active&&member.role==="admin"){
    document.body.classList.remove("auth-locked");
    document.querySelector("#authGate")?.classList.add("hidden");
    return true;
  }
  if(user){
    authStatus("Conta autenticada. Falta liberar este usuário como administrador. Avise no chat que a conta foi criada.","wait");
  }
  return false;
}
async function createFirstAccount(e){
  e.preventDefault();
  const email=document.querySelector("#authEmail").value.trim();
  const password=document.querySelector("#authPassword").value;
  if(password.length<8){authStatus("Use uma senha com pelo menos 8 caracteres.","error");return}
  setAuthBusy(true);
  authStatus("Criando sua conta com segurança...");
  try{
    const {data,error}=await authClient.auth.signUp({email,password});
    if(error)throw error;
    if(data?.session){
      authStatus("Conta criada. Agora falta liberar este usuário como administrador. Avise no chat.","wait");
    }else{
      authStatus("Conta criada. Abra o e-mail de confirmação, confirme e depois volte aqui para entrar.","success");
    }
    document.querySelector("#loginEmail").value=email;
  }catch(err){
    const msg=String(err?.message||"");
    if(/already|registered|exists/i.test(msg)) authStatus("Esse e-mail já possui conta. Use a opção “Já confirmei — entrar”.","error");
    else authStatus("Não consegui criar a conta: "+msg,"error");
  }finally{setAuthBusy(false)}
}
async function loginAdmin(e){
  e.preventDefault();
  const email=document.querySelector("#loginEmail").value.trim();
  const password=document.querySelector("#loginPassword").value;
  setAuthBusy(true);
  authStatus("Entrando...");
  try{
    const {error}=await authClient.auth.signInWithPassword({email,password});
    if(error)throw error;
    const ok=await verifyAdminAndUnlock();
    if(ok) location.reload();
  }catch(err){
    const msg=String(err?.message||"");
    authStatus(/confirm/i.test(msg)?"Confirme seu e-mail primeiro e tente novamente.":"Não consegui entrar. Confira e-mail e senha.","error");
  }finally{setAuthBusy(false)}
}
async function checkAdminAccess(){
  setAuthBusy(true);
  authStatus("Verificando sua conta...");
  try{
    const ok=await verifyAdminAndUnlock();
    if(ok) location.reload();
    else {
      const {data:{user}}=await authClient.auth.getUser();
      if(!user) authStatus("Você ainda não está conectado. Confirme o e-mail e use “Já confirmei — entrar”.","wait");
    }
  }finally{setAuthBusy(false)}
}
async function requireInitialAdminAuth(){
  const gate=document.querySelector("#authGate");
  if(!window.supabase?.createClient){
    gate?.classList.remove("hidden");
    authStatus("Não consegui carregar o sistema de login. Confira sua internet e atualize a página.","error");
    return false;
  }
  authClient=window.supabase.createClient(SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,{
    auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
  });
  window.tudoTalSupabase=authClient;

  document.querySelector("#firstAdminForm")?.addEventListener("submit",createFirstAccount);
  document.querySelector("#adminLoginForm")?.addEventListener("submit",loginAdmin);
  document.querySelector("#checkAdminAccessBtn")?.addEventListener("click",checkAdminAccess);

  const ok=await verifyAdminAndUnlock();
  if(ok)return true;

  gate?.classList.remove("hidden");
  const {data:{user}}=await authClient.auth.getUser();
  if(user){
    document.querySelector("#firstAdminForm")?.classList.add("hidden");
    document.querySelector("#authIntro").textContent="Sua conta já está autenticada. Estamos aguardando apenas a liberação como administrador da Tudo & Tal.";
  }
  return false;
}
