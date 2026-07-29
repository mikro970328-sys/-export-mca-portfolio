const SUPABASE_URL = process.env.SUPABASE_URL || 'https://qflncyhdspuvtrxsqgbj.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = process.env.SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_8JFI1fCW1dARm71kuQ1hmw_Jn6REY4z';

const PUBLIC_FIELDS = [
  'id',
  'category',
  'title',
  'description',
  'price',
  'currency',
  'quantity',
  'unit',
  'location_public',
  'departure_date',
  'arrival_date',
  'availability_status',
  'image_urls',
  'published_at'
].join(',');

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const endpoint = new URL(`${SUPABASE_URL}/rest/v1/commercial_publications`);
    endpoint.searchParams.set('select', PUBLIC_FIELDS);
    endpoint.searchParams.set('publication_status', 'eq.published');
    endpoint.searchParams.set('availability_status', 'neq.unavailable');
    endpoint.searchParams.set('order', 'published_at.desc.nullslast,created_at.desc');

    const response = await fetch(endpoint, {
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        Accept: 'application/json'
      }
    });

    if (!response.ok) {
      const detail = await response.text();
      console.error('Supabase publications error:', response.status, detail);
      return res.status(502).json({ error: 'Unable to load publications' });
    }

    const publications = await response.json();

    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.status(200).json({ publications });
  } catch (error) {
    console.error('Public publications API error:', error);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
