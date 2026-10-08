"use strict";

const SUPABASE_URL="https://iugryzipeqbgoplwqdqn.supabase.co";
const SUPABASE_PUBLISHABLE_KEY="sb_publishable_PbXYTHU7fS3VlkcrnvkwLQ_5A5JHwIR";
const APP_URL="https://anunes3-es-max.github.io/tudo-tal-App/";
let authClient=null;
let recoveryMode=false;

function authStatus(message,type="info"){
  const el=document.querySelector("#authStatus");
  if(!el)return;
  el.textContent=message;
  el.dataset.type=type;
}
function setAuthBusy(busy){
  document.querySelectorAll("#authGate button,#authGate input").forEach(el=>el.disabled=!!busy);
}
function showRecoveryForm(){
  recoveryMode=true;
  document.querySelector("#adminLoginForm")?.classList.add("hidden");
  document.querySelector("#forgotPasswordBtn")?.classList.add("hidden");
  document.querySelector("#checkAdminAccessBtn")?.classList.add("hidden");
  document.querySelector("#recoveryForm")?.classList.remove("hidden");
  const intro=document.querySelector("#authIntro");
  if(intro)intro.textContent="Defina uma nova senha para concluir a recuperação da sua conta.";
  authStatus("Digite a nova senha duas vezes e salve.","wait");
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
  if(!authClient||recoveryMode)return false;
  const {user,member}=await getAdminMembership();
  if(user&&member?.active&&member.role==="admin"){
    document.body.classList.remove("auth-locked");
    document.querySelector("#authGate")?.classList.add("hidden");
    return true;
  }
  if(user){
    authStatus("Sua conta entrou, mas não possui acesso administrativo ativo.","error");
  }
  return false;
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
    if(ok) location.href=APP_URL+"?v=7";
  }catch(err){
    const msg=String(err?.message||"");
    authStatus(/confirm/i.test(msg)
      ?"Seu e-mail ainda precisa ser confirmado."
      :"Não consegui entrar. Se você copiou a senha e continua dando erro, use “Esqueci minha senha”.","error");
  }finally{setAuthBusy(false)}
}
async function requestPasswordReset(){
  const email=document.querySelector("#loginEmail").value.trim();
  if(!email){
    authStatus("Digite seu e-mail no campo acima e depois toque em “Esqueci minha senha”.","wait");
    document.querySelector("#loginEmail")?.focus();
    return;
  }
  setAuthBusy(true);
  authStatus("Enviando o e-mail para redefinir sua senha...");
  try{
    const {error}=await authClient.auth.resetPasswordForEmail(email,{redirectTo:APP_URL});
    if(error)throw error;
    authStatus("Enviei o e-mail de recuperação. Abra a mensagem mais recente e toque no link. Você voltará para a Tudo & Tal para criar uma nova senha.","success");
  }catch(err){
    authStatus("Não consegui enviar a recuperação: "+String(err?.message||"erro desconhecido"),"error");
  }finally{setAuthBusy(false)}
}
async function saveRecoveredPassword(e){
  e.preventDefault();
  const password=document.querySelector("#newPassword").value;
  const confirm=document.querySelector("#confirmNewPassword").value;
  if(password.length<8){
    authStatus("A nova senha precisa ter pelo menos 8 caracteres.","error");
    return;
  }
  if(password!==confirm){
    authStatus("As duas senhas não são iguais.","error");
    return;
  }
  setAuthBusy(true);
  authStatus("Salvando sua nova senha...");
  try{
    const {error}=await authClient.auth.updateUser({password});
    if(error)throw error;
    recoveryMode=false;
    authStatus("Senha alterada com sucesso. Abrindo a Tudo & Tal...","success");
    const ok=await verifyAdminAndUnlock();
    if(ok) location.href=APP_URL+"?v=7";
    else{
      document.querySelector("#recoveryForm")?.classList.add("hidden");
      document.querySelector("#adminLoginForm")?.classList.remove("hidden");
      document.querySelector("#checkAdminAccessBtn")?.classList.remove("hidden");
    }
  }catch(err){
    authStatus("Não consegui salvar a nova senha: "+String(err?.message||"erro desconhecido"),"error");
  }finally{setAuthBusy(false)}
}
async function checkAdminAccess(){
  setAuthBusy(true);
  authStatus("Verificando sua conta...");
  try{
    const ok=await verifyAdminAndUnlock();
    if(ok) location.href=APP_URL+"?v=7";
    else{
      const {data:{user}}=await authClient.auth.getUser();
      if(!user)authStatus("Você ainda não está conectado. Entre com e-mail e senha.","wait");
    }
  }finally{setAuthBusy(false)}
}
function urlLooksLikeRecovery(){
  const hash=new URLSearchParams(location.hash.replace(/^#/,""));
  const query=new URLSearchParams(location.search);
  return hash.get("type")==="recovery" || query.get("type")==="recovery" || query.get("recovery")==="1";
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

  document.querySelector("#adminLoginForm")?.addEventListener("submit",loginAdmin);
  document.querySelector("#forgotPasswordBtn")?.addEventListener("click",requestPasswordReset);
  document.querySelector("#checkAdminAccessBtn")?.addEventListener("click",checkAdminAccess);
  document.querySelector("#recoveryForm")?.addEventListener("submit",saveRecoveredPassword);

  authClient.auth.onAuthStateChange((event)=>{
    if(event==="PASSWORD_RECOVERY"){
      gate?.classList.remove("hidden");
      document.body.classList.add("auth-locked");
      showRecoveryForm();
    }
  });

  if(urlLooksLikeRecovery()){
    gate?.classList.remove("hidden");
    showRecoveryForm();
    return false;
  }

  const ok=await verifyAdminAndUnlock();
  if(ok)return true;

  gate?.classList.remove("hidden");
  return false;
}
