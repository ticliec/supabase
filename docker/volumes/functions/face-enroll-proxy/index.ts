/**
 * Proxy de enrollment facial: valida JWT + área TALENTO_HUMANO (o admin) y reenvía al API Python.
 *
 * Secrets obligatorios (EasyPanel / Supabase): FACE_SERVICE_URL, FACE_ADMIN_API_KEY,
 * SUPABASE_SERVICE_ROLE_KEY (o SERVICE_ROLE_KEY).
 *
 * En self-hosted, si no inyectan SUPABASE_URL ni anon: se usa el origin de la petición
 * (/functions/v1/...) y el header `apikey` que ya manda supabase-js (clave pública).
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const cors: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

/** Texto útil para el ERP cuando FastAPI devuelve detail como string, objeto o array. */
function mensajeDesdeRespuestaApi(json: Record<string, unknown>, fallback: string): string {
  const d = json.detail
  const e = json.error
  if (typeof d === 'string' && d.trim()) return d
  if (typeof e === 'string' && e.trim()) return e
  if (Array.isArray(d) && d.length > 0) {
    const first = d[0] as { msg?: string } | string
    if (typeof first === 'string') return first
    if (first && typeof first === 'object' && typeof first.msg === 'string') return first.msg
  }
  if (d != null && typeof d === 'object') {
    try {
      return JSON.stringify(d)
    } catch {
      return fallback
    }
  }
  return fallback
}

function normalizarBase64(s: string): string {
  const t = s.trim()
  const m = t.match(/^data:image\/[a-zA-Z0-9.+-]+;base64,(.+)$/s)
  return m ? m[1].replace(/\s/g, '') : t.replace(/\s/g, '')
}

function resolveSupabaseUrl(req: Request): string {
  const env = (Deno.env.get('SUPABASE_URL') ?? '').trim().replace(/\/$/, '')
  if (env) return env
  try {
    return new URL(req.url).origin
  } catch {
    return ''
  }
}

function resolveAnonKey(req: Request): string {
  return (
    (Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('ANON_KEY') ?? '').trim() ||
    (req.headers.get('apikey') ?? '').trim()
  )
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

    const supabaseUrl = resolveSupabaseUrl(req)
    const serviceKey = (
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
      Deno.env.get('SERVICE_ROLE_KEY') ??
      ''
    ).trim()
    const anonKey = resolveAnonKey(req)
    const faceUrl = (Deno.env.get('FACE_SERVICE_URL') ?? '').trim().replace(/\/$/, '')
    const faceAdminKey = (Deno.env.get('FACE_ADMIN_API_KEY') ?? '').trim()

    const faltan: string[] = []
    if (!supabaseUrl) faltan.push('SUPABASE_URL (o URL inválida en la petición)')
    if (!serviceKey) faltan.push('SUPABASE_SERVICE_ROLE_KEY o SERVICE_ROLE_KEY')
    if (!anonKey) faltan.push('SUPABASE_ANON_KEY o que el cliente envíe header apikey')
    if (!faceUrl) faltan.push('FACE_SERVICE_URL')
    if (!faceAdminKey) faltan.push('FACE_ADMIN_API_KEY')
    if (faltan.length > 0) {
      return new Response(
        JSON.stringify({
          error: `Config incompleta (face-enroll-proxy). Define secrets en el runtime de Edge Functions. Faltan: ${faltan.join('; ')}.`,
        }),
        {
          status: 500,
          headers: { ...cors, 'Content-Type': 'application/json' },
        },
      )
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
    const pidNum = Number(body.personal_id)
    const b64Raw = body.image_base64
    if (
      !Number.isInteger(pidNum) ||
      pidNum < 1 ||
      typeof b64Raw !== 'string' ||
      b64Raw.length < 32
    ) {
      return new Response(JSON.stringify({ error: 'personal_id o imagen inválidos' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    const pid = pidNum
    const b64 = normalizarBase64(b64Raw)
    if (b64.length < 32) {
      return new Response(JSON.stringify({ error: 'personal_id o imagen inválidos' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }

    let raw: Uint8Array
    try {
      raw = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
    } catch {
      return new Response(JSON.stringify({ error: 'Imagen en base64 inválida' }), {
        status: 400,
        headers: { ...cors, 'Content-Type': 'application/json' },
      })
    }
    const fd = new FormData()
    const fn = body.filename ?? 'face.webp'
    const isJpeg = fn.toLowerCase().endsWith('.jpg') || fn.toLowerCase().endsWith('.jpeg')
    const mime = isJpeg ? 'image/jpeg' : 'image/webp'
    const name = fn.includes('.') ? fn : isJpeg ? 'face.jpg' : 'face.webp'
    fd.append('file', new Blob([raw], { type: mime }), name)

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
      const errMsg = mensajeDesdeRespuestaApi(json, text)
      return new Response(JSON.stringify({ error: errMsg }), {
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

