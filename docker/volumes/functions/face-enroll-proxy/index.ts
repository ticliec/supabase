/**
 * Proxy de enrollment facial: valida JWT + área TALENTO_HUMANO (o admin) y reenvía al API Python.
 * Secrets: FACE_SERVICE_URL (ej. https://face-api.tu-dominio.com), FACE_ADMIN_API_KEY
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: cors })
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Sin autorización' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('ANON_KEY') ?? ''
    const faceUrl = (Deno.env.get('FACE_SERVICE_URL') ?? '').replace(/\/$/, '')
    const faceAdminKey = Deno.env.get('FACE_ADMIN_API_KEY') ?? ''

    if (!supabaseUrl || !serviceKey || !anonKey || !faceUrl || !faceAdminKey) {
      return new Response(JSON.stringify({ error: 'Config incompleta en Edge Function' }), {
        status: 500,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUser = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const {
      data: { user },
      error: userErr,
    } = await supabaseUser.auth.getUser()
    if (userErr || !user) {
      return new Response(JSON.stringify({ error: 'Sesión inválida' }), {
        status: 401,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const sb = createClient(supabaseUrl, serviceKey)
    const { data: prof } = await sb
      .from('user_profiles')
      .select('area_id, es_admin_sistema')
      .eq('id', user.id)
      .maybeSingle()

    let okTh = prof?.es_admin_sistema === true
    if (!okTh && prof?.area_id != null) {
      const { data: ar } = await sb.from('areas').select('clave').eq('id', prof.area_id).maybeSingle()
      okTh = ar?.clave === 'TALENTO_HUMANO'
    }
    if (!okTh) {
      return new Response(JSON.stringify({ error: 'Solo Talento Humano puede registrar rostros' }), {
        status: 403,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const body = (await req.json()) as { personal_id?: number; image_base64?: string; filename?: string }
    const pid = body.personal_id
    const b64 = body.image_base64
    if (pid == null || typeof b64 !== 'string' || b64.length < 32) {
      return new Response(JSON.stringify({ error: 'personal_id o imagen inválidos' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    const raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    const fd = new FormData()
    const name = body.filename?.endsWith('.webp') ? body.filename : 'face.webp'
    fd.append('file', new Blob([raw], { type: 'image/webp' }), name)

    const res = await fetch(`${faceUrl}/v1/enroll/${pid}`, {
      method: 'POST',
      headers: { 'X-Admin-Key': faceAdminKey },
      body: fd,
    })

    const text = await res.text()
    let json: Record<string, unknown> = {}
    try {
      json = JSON.parse(text) as Record<string, unknown>
    } catch {
      json = { raw: text }
    }

    if (!res.ok) {
      return new Response(JSON.stringify({ error: json.detail ?? json.error ?? text }), {
        status: res.status,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify(json), {
      status: 200,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...cors, 'Content-Type': 'application/json' },
    })
  }
})
