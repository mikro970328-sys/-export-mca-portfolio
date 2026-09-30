import {supabase} from './_lib.js';

// REST limits apply independently of an explicit SQL limit. Small datasets
// still need one request. Larger lists use stable ordering and bounded pages
// instead of silently losing rows, capabilities or fulfillment links.
export async function readShipmentListPages(path,query,{maxRows=50000}={}) {
  if(!/[?&]order=/.test(query)||/[?&](limit|offset)=/.test(query)
    ||!Number.isSafeInteger(maxRows)||maxRows<1)throw Error('SHIPMENT_LIST_QUERY_INVALID');
  const pageSize=500,rows=[];
  for(let offset=0;offset<=maxRows;offset+=pageSize){
    const page=await supabase(path,{query:`${query}&limit=${pageSize}&offset=${offset}`});
    if(!Array.isArray(page))throw Error('SHIPMENT_LIST_RESPONSE_INVALID');
    if(rows.length+page.length>maxRows)throw Error('SHIPMENT_LIST_VOLUME_LIMIT');
    rows.push(...page);
    if(page.length<pageSize)return rows;
  }
  throw Error('SHIPMENT_LIST_VOLUME_LIMIT');
}
