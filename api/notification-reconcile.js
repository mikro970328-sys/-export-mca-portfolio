import { authorizeAdmin, fail, ok, supabase, writeAudit } from './_lib.js';

function cronAuthorized(req){
  const secret=process.env.CRON_SECRET;
  return Boolean(secret)&&req.headers.authorization===`Bearer ${secret}`;
}

async function run(){
  const result=await supabase('rpc/reconcile_user_notifications',{
    method:'POST',
    body:{p_now:new Date().toISOString()},
    prefer:'return=representation'
  });
  return Array.isArray(result)?result[0]||{}:result||{};
}

export default async function handler(req,res){
  const cron=cronAuthorized(req);
  let admin=null;
  if(!cron){
    admin=await authorizeAdmin(req,res,'notifications.manage');
    if(!admin)return;
  }
  if(!['GET','POST'].includes(req.method))return fail(res,405,'Método no permitido');

  try{
    const result=await run();
    if(admin)await writeAudit(admin,'notification.reconcile','notification_inbox',null,result);
    return ok(res,{reconciliation:result});
  }catch(error){
    console.error('NOTIFICATION_RECONCILE_ERROR',error);
    return fail(res,500,'No se pudieron reconciliar las notificaciones');
  }
}
