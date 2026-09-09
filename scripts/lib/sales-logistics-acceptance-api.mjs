import fs from 'node:fs';
import vm from 'node:vm';
import { ok, fail, readJson } from '../../api/_lib.js';

// Real handlers and action/availability helpers, with only _lib auth, audit and
// transport substituted. No JWT, network, Storage or audit-delivery certification.
export function salesLogisticsAcceptanceApi(db) {
  const calls=[], audits=[], errors=[], users=new Map(), modules={};
  const rpcNames=new Set(['create_sales_order_plan','replace_sales_order_plan','transition_sales_order',
    'create_load_from_sales_order','sales_order_linkable_existing_loads','link_existing_load_to_sales_order',
    'create_load_plan','replace_load_plan_canonical','execute_load_action','create_load_shipment_canonical',
    'assign_load_shipment_canonical','mark_direct_shipment_dispatched']);
  const readTables=new Set(['clients','importers','client_importers','products','warehouses','shipments',
    'sales_order_progress','sales_order_item_progress','sales_order_action_capabilities',
    'inventory_source_balances','inventory_summary','load_action_capabilities','load_traceability_sources',
    'shipment_direct_supply_contents','shipment_customs_document_readiness']);
  const readSql={
    sales_orders:'select so.*,to_jsonb(c) as client,to_jsonb(i) as importer from sales_orders so join clients c on c.id=so.client_id left join importers i on i.id=so.importer_id',
    sales_order_items:'select soi.*,to_jsonb(p) as product from sales_order_items soi join products p on p.id=soi.product_id',
    sales_fulfillment_allocations:"select sfa.*,to_jsonb(li)||jsonb_build_object('load',to_jsonb(l)) as load_item from sales_fulfillment_allocations sfa join load_items li on li.id=sfa.load_item_id join loads l on l.id=li.load_id",
    loads:'select l.*,to_jsonb(w) as warehouse,to_jsonb(c) as client,to_jsonb(i) as importer,to_jsonb(s) as shipment from loads l join warehouses w on w.id=l.warehouse_id left join clients c on c.id=l.client_id left join importers i on i.id=l.importer_id left join shipments s on s.id=l.shipment_id',
    load_items:"select li.*,to_jsonb(p) as product,coalesce((select jsonb_agg(to_jsonb(la)||jsonb_build_object('receipt_item',to_jsonb(wri)||jsonb_build_object('receipt',to_jsonb(wr)))) from load_allocations la join warehouse_receipt_items wri on wri.id=la.receipt_item_id join warehouse_receipts wr on wr.id=wri.receipt_id where la.load_item_id=li.id),'[]'::jsonb) as allocations from load_items li join products p on p.id=li.product_id"
  };
  async function rpc(name,body) {
    if(!rpcNames.has(name))throw Error(`Unsupported test RPC ${name}`);
    const entries=Object.entries(body);
    if(entries.some(([key])=>!/^p_[a-z_]+$/.test(key)))throw Error('Invalid test parameter');
    await db.exec('savepoint api_rpc');
    try {
      const result=await db.query(`select * from ${name}(${entries.map(([key],i)=>`${key}=>$${i+1}`).join(',')})`,entries.map(([,v])=>Array.isArray(v)?JSON.stringify(v):v));
      await db.exec('release savepoint api_rpc'); return result.rows;
    } catch(error) { await db.exec('rollback to savepoint api_rpc; release savepoint api_rpc'); throw error; }
  }
  const lib={ok,fail,readJson,
    async authorizeAdmin(req,res,permission) {
      if(!req.testAdmin){fail(res,401,'No autorizado');return null;}
      if(req.testAdmin.role!=='master_admin'&&!req.testAdmin.permissions.includes(permission)){fail(res,403,'No tienes permiso');return null;}
      return req.testAdmin;
    },
    async loadAdminAccessContext(id){return {permissions:users.get(id)?.permissions||[]};},
    async writeAudit(...args){audits.push(args);},
    async supabase(path,options={}) {
      calls.push({path,...options});
      if(path.startsWith('rpc/')&&options.method==='POST')return rpc(path.slice(4),options.body);
      if(path==='shipment_history'&&options.method==='POST') {
        const result=[];
        for(const row of options.body) result.push((await db.query('insert into shipment_history(shipment_id,client_id,event_type,title,details,source) values($1,$2,$3,$4,$5,$6) returning *',[row.shipment_id,row.client_id,row.event_type,row.title,row.details,row.source])).rows[0]);
        return result;
      }
      if(options.method&&options.method!=='GET')throw Error(`Unsupported test mutation ${path}`);
      if(!readSql[path]&&!readTables.has(path))throw Error(`Unsupported test read ${path}`);
      let result=(await db.query(readSql[path]||`select * from ${path}`)).rows;
      const query=new URLSearchParams(options.query||'');
      for(const [key,value] of query) {
        if(['select','order','limit','offset'].includes(key))continue;
        if(value.startsWith('eq.'))result=result.filter(row=>String(row[key])===value.slice(3));
        else if(value.startsWith('in.('))result=result.filter(row=>value.slice(4,-1).split(',').includes(String(row[key])));
        else throw Error(`Unsupported test filter ${key}`);
      }
      const limit=Number(query.get('limit')||result.length),offset=Number(query.get('offset')||0);
      return result.slice(offset,offset+limit);
    }
  };
  const allowed=new Set(['_sales-actions','_load-actions','_load-plan-availability','sales','sales-order-ux','sales-loads','loads','direct-shipment-dispatch','shipment-document-readiness']);
  function module(name) {
    if(modules[name])return modules[name];
    if(!allowed.has(name))throw Error(`Unsupported test module ${name}`);
    const source=fs.readFileSync(`api/${name}.js`,'utf8');
    const exports=[...source.matchAll(/export (?:async )?function (\w+)/g)].map(match=>match[1]);
    const imports={_lib:lib};
    const runnable=source.replace(/^import \{([^}]+)\} from '\.\/([^']+)\.js';$/gm,(_,bindings,dependency)=>{
      if(dependency!=='_lib')imports[dependency]=module(dependency);
      return `const {${bindings}}=imports[${JSON.stringify(dependency)}];`;
    }).replace(/export default async function handler/,'async function handler').replace(/export ((?:async )?function )/g,'$1');
    if(/^import |^export /m.test(runnable))throw Error('Module boundary changed; review test adapter');
    const hasHandler=source.includes('export default async function handler');
    return modules[name]=vm.runInNewContext(`${runnable}\n({${[...exports,...(hasHandler?['handler']:[])].join(',')}});`,
      {imports,console:{error(...args){errors.push(args);}},URLSearchParams,Date,JSON,Map,Set});
  }
  return {calls,audits,errors,
    async request(name,{method='GET',body,admin,query={}}={}) {
      if(admin)users.set(admin.admin_id,admin);
      const res={statusCode:0,setHeader(){},end(value){this.body=JSON.parse(value);}};
      await module(name).handler({method,body,query,testAdmin:admin},res);
      return {status:res.statusCode,body:res.body};
    }
  };
}
