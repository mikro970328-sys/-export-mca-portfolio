import { authorizeAdmin, fail, ok, writeAudit } from './_lib.js';
import { reconcileAllNotifications } from './_notification-reconcile.js';

function cronAuthorized(req){
  const secret=process.env.CRON_SECRET;
  return Boolean(secret)&&req.headers.authorization===`Bearer ${secret}`;
}

async function run(){
  return reconcileAllNotifications(new Date().toISOString());
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
