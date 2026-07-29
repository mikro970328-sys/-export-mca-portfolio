const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qflncyhdspuvtrxsqgbj.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_8JFI1fCW1dARm71kuQ1hmw_Jn6REY4z';
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_PUBLISHABLE_KEY;

const PUBLIC_FIELDS = [
  'id','category','title','description','price','currency','quantity','unit','location_public',
  'departure_date','arrival_date','availability_status','image_urls','published_at','assigned_worker_id',
  'assigned_worker:workers!commercial_publications_assigned_worker_id_fkey(id,full_name,phone,position,is_active)'
].join(',');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error:'Method not allowed' });
  }
  try {
    const endpoint = new URL(`${SUPABASE_URL}/rest/v1/commercial_publications`);
    endpoint.searchParams.set('select', PUBLIC_FIELDS);
    endpoint.searchParams.set('publication_status', 'eq.published');
    endpoint.searchParams.set('availability_status', 'neq.unavailable');
    endpoint.searchParams.set('order', 'published_at.desc.nullslast,created_at.desc');
    const response = await fetch(endpoint, { headers:{ apikey:SUPABASE_SERVICE_ROLE_KEY, Authorization:`Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, Accept:'application/json' } });
    if (!response.ok) {
      const detail = await response.text();
      console.error('Supabase publications error:', response.status, detail);
      return res.status(502).json({ error:'Unable to load publications' });
    }
    const rows = await response.json();
    const publications = rows.map(({ assigned_worker, ...row }) => ({
      ...row,
      assigned_worker_name: assigned_worker?.is_active === false ? null : assigned_worker?.full_name || null,
      assigned_worker_phone: assigned_worker?.is_active === false ? null : assigned_worker?.phone || null
    }));
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json({ publications });
  } catch (error) {
    console.error('Public publications API error:', error);
    return res.status(500).json({ error:'Internal server error' });
  }
}
