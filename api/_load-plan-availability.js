import { supabase } from './_lib.js';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const quantity=value=>{
  const parsed=Number(value??0);
  return Number.isFinite(parsed)?parsed:0;
};

export function assertAllocationsWithinAvailability(lines,balances){
  const requested=new Map();
  for(const line of lines||[]){
    for(const allocation of line?.allocations||[]){
      const id=String(allocation?.receipt_item_id||'').trim();
      if(!UUID.test(id))throw new Error('RECEIPT_ITEM_NOT_FOUND');
      const current=requested.get(id)||{quantity:0,pallets:0};
      current.quantity+=quantity(allocation.allocated_quantity);
      current.pallets+=quantity(allocation.allocated_pallets);
      requested.set(id,current);
    }
  }

  const available=new Map((balances||[]).map(row=>[String(row.receipt_item_id),{
    quantity:quantity(row.physical_quantity)-quantity(row.reserved_quantity),
    pallets:quantity(row.physical_pallets)-quantity(row.reserved_pallets)
  }]));

  for(const [id,need] of requested){
    const balance=available.get(id);
    if(!balance||need.quantity>balance.quantity+1e-9||need.pallets>balance.pallets+1e-9){
      throw new Error('INSUFFICIENT_WR_AVAILABLE_BALANCE');
    }
  }
  return true;
}

export async function assertLoadPlanAvailability(lines){
  const ids=[...new Set((lines||[]).flatMap(line=>(line?.allocations||[]).map(allocation=>String(allocation?.receipt_item_id||'').trim())))];
  if(!ids.length)throw new Error('LOAD_ALLOCATIONS_REQUIRED');
  if(ids.some(id=>!UUID.test(id)))throw new Error('RECEIPT_ITEM_NOT_FOUND');
  const chunks=[];
  for(let index=0;index<ids.length;index+=100)chunks.push(ids.slice(index,index+100));
  const pages=await Promise.all(chunks.map(chunk=>supabase('inventory_source_balances',{
    query:`?select=receipt_item_id,physical_quantity,physical_pallets,reserved_quantity,reserved_pallets&receipt_item_id=in.(${chunk.join(',')})&limit=${chunk.length}`
  })));
  return assertAllocationsWithinAvailability(lines,pages.flatMap(page=>page||[]));
}
