import fs from 'node:fs';
import vm from 'node:vm';
import { ok, fail, readJson } from '../../api/_lib.js';

// Real handlers/helpers; auth, audit delivery and PostgREST transport are adapters.
// Financial calculations and write guards execute against real SQL owners.
export function financeAcceptanceApi(db) {
  const calls=[],audits=[],errors=[],users=new Map(),modules={};
  const rpcNames=new Set(['create_invoice_plan','replace_invoice_plan','transition_invoice','register_invoice_payment',
    'reverse_invoice_payment','register_customer_advance','apply_customer_advance','refund_customer_advance',
    'reverse_customer_advance','reverse_customer_advance_application','reverse_customer_advance_refund',
    'register_supplier_payment','pay_supplier_bill_canonical','replace_supplier_payment_applications_canonical',
    'reverse_supplier_payment_canonical','create_cost_charge','create_posted_cost_charge','replace_cost_charge_canonical',
    'post_cost_charge_canonical','void_cost_charge_canonical','executive_report_dataset','executive_dashboard_rollup']);
  const readTables=new Set(['clients','suppliers','products','invoices','invoice_items','payments','invoice_financial_progress',
    'invoice_action_capabilities','payment_action_capabilities','sales_orders','sales_order_items','sales_order_item_invoice_progress',
    'sales_order_customer_financial_progress','customer_advance_progress','customer_advances','customer_advance_applications','customer_advance_refunds',
    'sales_order_customer_finance_action_capabilities','proforma_action_capabilities','customer_advance_action_capabilities',
    'customer_advance_application_action_capabilities','customer_advance_refund_action_capabilities','supplier_payments',
    'supplier_payment_progress','supplier_payment_applications','supplier_bill_action_capabilities','supplier_payment_action_capabilities',
    'supplier_bills','supplier_bill_financial_progress','purchase_orders','cost_charges','cost_charge_allocations','cost_charge_progress',
    'cost_charge_action_capabilities','warehouse_receipts','loads','shipments','operations','purchase_order_item_merchandise_cost_basis',
    'warehouse_receipt_item_merchandise_cost','load_merchandise_cogs','posted_cost_charge_allocations','load_direct_costs',
    'shipment_direct_costs','operation_direct_costs','sales_order_direct_costs']);
  const readSql={
    invoices:'select i.*,to_jsonb(c) as client,to_jsonb(so) as sales_order from invoices i join clients c on c.id=i.client_id join sales_orders so on so.id=i.sales_order_id',
    invoice_items:'select i.*,to_jsonb(p) as product from invoice_items i join products p on p.id=i.product_id',
    sales_orders:'select so.*,to_jsonb(c) as client from sales_orders so join clients c on c.id=so.client_id',
    sales_order_items:'select i.*,to_jsonb(p) as product from sales_order_items i join products p on p.id=i.product_id',
    supplier_payments:'select p.*,to_jsonb(s) as supplier,to_jsonb(po) as purchase_order from supplier_payments p join suppliers s on s.id=p.supplier_id join purchase_orders po on po.id=p.purchase_order_id'
  };
  async function rpc(name,body) {
    if(!rpcNames.has(name))throw Error(`Unsupported finance RPC ${name}`);
    const entries=Object.entries(JSON.parse(JSON.stringify(body)));if(entries.some(([key])=>!/^p_[a-z_]+$/.test(key)))throw Error('Invalid test parameter');
    await db.exec('savepoint api_rpc');
    try {
      const args=entries.map(([key],i)=>`${key}=>$${i+1}`).join(','),scalar=name.startsWith('executive_');
      const result=await db.query(scalar?`select ${name}(${args}) as payload`:`select * from ${name}(${args})`,entries.map(([,value])=>Array.isArray(value)?JSON.stringify(value):value));
      await db.exec('release savepoint api_rpc');return JSON.parse(JSON.stringify(scalar?result.rows[0].payload:result.rows));
    }catch(error){await db.exec('rollback to savepoint api_rpc; release savepoint api_rpc');throw error;}
  }
  const lib={ok,fail,readJson,
    async authorizeAdmin(req,res,permission){
      if(!req.testAdmin){fail(res,401,'No autorizado');return null;}
      if(req.testAdmin.role!=='master_admin'&&!req.testAdmin.permissions.includes(permission)){fail(res,403,'No tienes permiso');return null;}
      return req.testAdmin;
    },
    async loadAdminAccessContext(id){return {permissions:users.get(id)?.permissions||[]};},
    async writeAudit(...args){audits.push(args);},
    async supabase(path,options={}){
      calls.push({path,...options});
      if(path.startsWith('rpc/')&&options.method==='POST')return rpc(path.slice(4),options.body);
      if(options.method&&options.method!=='GET')throw Error(`Unsupported test write ${path}`);
      if(!readTables.has(path))throw Error(`Unsupported test read ${path}`);
      // PGlite Date objects must cross a JSON boundary just like PostgREST dates.
      let data=JSON.parse(JSON.stringify((await db.query(readSql[path]||`select * from ${path}`)).rows));
      const query=new URLSearchParams(options.query||'');
      for(const [key,value] of query){
        if(['select','order','limit','offset'].includes(key))continue;
        if(value.startsWith('eq.'))data=data.filter(row=>String(row[key])===value.slice(3));
        else if(value.startsWith('in.('))data=data.filter(row=>value.slice(4,-1).split(',').includes(String(row[key])));
        else throw Error(`Unsupported test filter ${key}`);
      }
      const offset=Number(query.get('offset')||0),limit=Number(query.get('limit')||data.length);return data.slice(offset,offset+limit);
    }
  };
  const allowed=new Set(['invoices','invoice-payments','customer-advances','supplier-payments','costs','reports',
    '_invoice-actions','_customer-finance-actions','_supplier-ap-actions','_cost-actions','_executive-dashboard']);
  function module(name){
    if(modules[name])return modules[name];if(!allowed.has(name))throw Error(`Unsupported test module ${name}`);
    const source=fs.readFileSync(`api/${name}.js`,'utf8'),exports=[...source.matchAll(/export (?:async )?function (\w+)/g)].map(m=>m[1]),imports={_lib:lib};
    const runnable=source.replace(/^import \{([^}]+)\} from '\.\/([^']+)\.js';$/gm,(_,bindings,dependency)=>{
      if(dependency!=='_lib')imports[dependency]=module(dependency);return `const {${bindings}}=imports[${JSON.stringify(dependency)}];`;
    }).replace(/export default async function handler/,'async function handler').replace(/export ((?:async )?function )/g,'$1');
    if(/^import |^export /m.test(runnable))throw Error('Review module adapter boundary');
    return modules[name]=vm.runInNewContext(`${runnable}\n({${[...exports,...(source.includes('export default async function handler')?['handler']:[])].join(',')}});`,{imports,console:{error(...args){errors.push(args);}},URLSearchParams,Date,JSON,Map,Set});
  }
  return {calls,audits,errors,async request(name,{method='GET',body,admin,query={}}={}){
    if(admin)users.set(admin.admin_id,admin);
    const res={statusCode:0,headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.body=this.headers['Content-Type']?.startsWith('text/csv')?value:JSON.parse(value);}};
    await module(name).handler({method,body,query,testAdmin:admin},res);
    return {status:res.statusCode,body:res.body,headers:res.headers};
  }};
}
