import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const BUCKET = 'erp-doc-staging'
const BATCH = 50

/**
 * Deletes staged objects for completed jobs older than 30 days (by processed_at).
 * Invoke from Supabase scheduled functions or external cron with header:
 *   x-cron-secret: <CRON_SECRET>
 * Set CRON_SECRET in Edge Function secrets.
 */
Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const secret = Deno.env.get('CRON_SECRET')
  const provided = req.headers.get('x-cron-secret')

  if (!secret || provided !== secret) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)

  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  const { data: jobs, error: qErr } = await admin
    .from('document_delivery_jobs')
    .select('id, storage_bucket, storage_path')
    .eq('status', 'completed')
    .is('storage_purged_at', null)
    .not('storage_path', 'is', null)
    .lt('processed_at', cutoff)
    .limit(BATCH)

  if (qErr) {
    console.error('cleanup query', qErr)
    return new Response(JSON.stringify({ error: 'Query failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let purged = 0

  for (const row of jobs ?? []) {
    const bucket = row.storage_bucket || BUCKET
    const path = row.storage_path as string

    const { error: rmErr } = await admin.storage.from(bucket).remove([path])
    if (rmErr) {
      console.error('remove', path, rmErr)
      continue
    }

    const { error: upErr } = await admin
      .from('document_delivery_jobs')
      .update({
        storage_purged_at: new Date().toISOString(),
        storage_path: null,
      })
      .eq('id', row.id)

    if (!upErr) purged++
  }

  return new Response(JSON.stringify({ ok: true, purged, scanned: jobs?.length ?? 0 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  })
})
