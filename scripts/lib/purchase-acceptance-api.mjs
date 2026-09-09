import fs from 'node:fs';
import vm from 'node:vm';
import { ok, fail, readJson } from '../../api/_lib.js';

// Only the _lib transport/auth/audit boundaries are replaced. Both handlers run
// unchanged; RPCs execute against the disposable SQL database. This does not
// certify JWT authentication, PostgREST transport or production audit delivery.
export function purchaseAcceptanceApi(db) {
  const calls=[];
  const audits=[];
  const rpcNames=new Set(['create_purchase_order_plan','replace_purchase_order_plan','transition_purchase_order','receive_purchase_order_lines']);
  const readTables=new Set(['purchase_order_progress','purchase_order_action_capabilities','suppliers','warehouses','products','inventory_source_balances','inventory_traceability']);
  const lib={
    ok,fail,readJson,
    async authorizeAdmin(req,res,permission) {
      if(!req.testAdmin) { fail(res,401,'No autorizado'); return null; }
      if(req.testAdmin.role!=='master_admin'&&!req.testAdmin.permissions.includes(permission)) {
        fail(res,403,'No tienes permiso'); return null;
      }
      return req.testAdmin;
    },
    async loadAdminAccessContext(id) { return {permissions:users.get(id)?.permissions||[]}; },
    async writeAudit(...args) { audits.push(args); },
    async supabase(path,options={}) {
      calls.push({path,...options});
      if(path.startsWith('rpc/')) {
        const name=path.slice(4);
        if(!rpcNames.has(name)||options.method!=='POST')throw Error(`Unsupported test RPC: ${path}`);
        const entries=Object.entries(options.body);
        if(entries.some(([key])=>!/^p_[a-z_]+$/.test(key)))throw Error('Invalid test RPC parameter');
        const args=entries.map(([key],i)=>`${key}=>$${i+1}`).join(',');
        // Each real PostgREST RPC is its own transaction. A savepoint models
        // that boundary inside the outer disposable test transaction.
        await db.exec('savepoint api_rpc');
        try {
          const result=await db.query(`select * from public.${name}(${args})`,entries.map(([,value])=>Array.isArray(value)?JSON.stringify(value):value));
          await db.exec('release savepoint api_rpc');
          return result.rows;
        } catch(error) {
          await db.exec('rollback to savepoint api_rpc; release savepoint api_rpc');
          throw error;
        }
      }
      if(options.method&&options.method!=='GET')throw Error('Unexpected test mutation');
      if(path==='purchase_orders')return (await db.query('select po.*,to_jsonb(s) as supplier,to_jsonb(w) as warehouse from purchase_orders po join suppliers s on s.id=po.supplier_id left join warehouses w on w.id=po.warehouse_id order by po.created_at')).rows;
      if(path==='purchase_order_items')return (await db.query('select poi.*,to_jsonb(p) as product from purchase_order_items poi join products p on p.id=poi.product_id order by poi.created_at')).rows;
      if(path==='purchase_receipt_allocations')return (await db.query("select pra.*,to_jsonb(wri)||jsonb_build_object('receipt',to_jsonb(wr)) as receipt_item from purchase_receipt_allocations pra join warehouse_receipt_items wri on wri.id=pra.receipt_item_id join warehouse_receipts wr on wr.id=wri.receipt_id")).rows;
      if(!readTables.has(path))throw Error(`Unsupported test read: ${path}`);
      return (await db.query(`select * from public.${path}${options.query?.includes('active=eq.true')?' where active=true':''}`)).rows;
    }
  };
  const users=new Map();
  const handlers={};
  for(const name of ['purchases','inventory']) {
    const source=fs.readFileSync(`api/${name}.js`,'utf8');
    const importPattern=/^import \{([^}]+)\} from '\.\/_lib\.js';/;
    if(!importPattern.test(source))throw Error('API import boundary changed; review test adapter');
    const runnable=source.replace(importPattern,'const {$1}=testLib;').replace('export default async function handler','async function handler');
    handlers[name]=vm.runInNewContext(`${runnable}\nhandler;`,{testLib:lib,console:{error(){}},URLSearchParams,Date,JSON,Map,Set});
  }
  return {
    calls,audits,
    async request(name,{method='GET',body,admin,query={}}={}) {
      if(admin)users.set(admin.admin_id,admin);
      const res={statusCode:0,setHeader(){},end(text){this.body=JSON.parse(text);}};
      await handlers[name]({method,body,query,testAdmin:admin},res);
      return {status:res.statusCode,body:res.body};
    }
  };
}
