// Edge Function: sube archivo a Storage y crea fila en document_delivery_jobs.
//
// Supabase Cloud: supabase functions deploy enqueue-document-delivery
//
// Self-hosted (Docker / EasyPanel): `supabase functions deploy` no siempre copia código a tu VPS.
// El runtime debe ver la carpeta con `index.ts` montada donde el servicio `functions` la espera
// (p. ej. volumen `.../functions/enqueue-document-delivery/index.ts`). Si ves:
//   InvalidWorkerCreation … could not find an appropriate entrypoint
// revisa que esa ruta exista en el contenedor y reinicia el servicio de funciones. Ver:
// https://supabase.com/docs/guides/self-hosting/self-hosted-functions

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-requested-with',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const BUCKET = 'erp-doc-staging'
const MAX_BYTES = 50 * 1024 * 1024

function safeFilename(name: string): string {
  const base = name.replace(/[/\\?%*:|"<>]/g, '_').trim() || 'document'
  return base.slice(0, 200)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })

  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser()

  if (userErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid multipart body' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const file = form.get('file')
  if (!(file instanceof File)) {
    return new Response(JSON.stringify({ error: 'Missing file field' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  if (file.size > MAX_BYTES) {
    return new Response(JSON.stringify({ error: 'File too large' }), {
      status: 413,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const documentKey = String(form.get('document_key') ?? '').trim()
  if (!documentKey) {
    return new Response(JSON.stringify({ error: 'document_key required' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const suggestedFilename = String(form.get('suggested_filename') ?? '').trim()
  const finalName = safeFilename(suggestedFilename || file.name)

  let pathVariables: Record<string, string> = {}
  const pvRaw = form.get('path_variables')
  if (typeof pvRaw === 'string' && pvRaw.length > 0) {
    try {
      const parsed = JSON.parse(pvRaw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        pathVariables = Object.fromEntries(
          Object.entries(parsed as Record<string, unknown>).map(([k, v]) => [
            k,
            String(v ?? ''),
          ]),
        )
      }
    } catch {
      return new Response(JSON.stringify({ error: 'path_variables must be JSON object' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
  }

  const admin = createClient(supabaseUrl, serviceRoleKey)

  const { data: rule, error: ruleErr } = await admin
    .from('document_route_rules')
    .select('document_key')
    .eq('document_key', documentKey)
    .eq('is_active', true)
    .maybeSingle()

  if (ruleErr || !rule) {
    return new Response(
      JSON.stringify({ error: 'Unknown or inactive document_key' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }

  const jobId = crypto.randomUUID()
  const storagePath = `staging/${jobId}/${finalName}`

  const bytes = new Uint8Array(await file.arrayBuffer())

  const { error: uploadErr } = await admin.storage.from(BUCKET).upload(storagePath, bytes, {
    contentType: file.type || 'application/octet-stream',
    upsert: false,
  })

  if (uploadErr) {
    console.error('storage upload', uploadErr)
    return new Response(JSON.stringify({ error: 'Storage upload failed' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const { error: insertErr } = await admin.from('document_delivery_jobs').insert({
    id: jobId,
    created_by: user.id,
    document_key: documentKey,
    storage_bucket: BUCKET,
    storage_path: storagePath,
    path_variables: pathVariables,
    suggested_filename: finalName,
    status: 'pending',
    expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
  })

  if (insertErr) {
    console.error('job insert', insertErr)
    await admin.storage.from(BUCKET).remove([storagePath])
    return new Response(JSON.stringify({ error: 'Failed to create delivery job' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(
    JSON.stringify({
      job_id: jobId,
      storage_path: storagePath,
    }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
  )
})
