
// Supabase Edge Function: genera link de invitación sin enviar correo.
// Útil para compartir por WhatsApp u otros canales.
//
// Supabase Cloud: supabase functions deploy generate-invite-link
// Self-hosted: copiar a volumes/functions/generate-invite-link/ y reiniciar.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Falta Authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const anonKey =
      Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('ANON_KEY') ?? ''
    // URL pública de Supabase (accesible desde internet).
    // En self-hosted (EasyPanel/Docker), SUPABASE_URL apunta al gateway interno (kong).
    // API_EXTERNAL_URL debe ser la URL pública del servicio Supabase.
    const apiExternalUrl = (
      Deno.env.get('API_EXTERNAL_URL') ??
      Deno.env.get('SUPABASE_PUBLIC_URL') ??
      ''
    ).replace(/\/$/, '')

    if (!supabaseUrl || !serviceKey || !anonKey) {
      return new Response(
        JSON.stringify({
          error: 'Faltan variables de entorno (SUPABASE_URL, SERVICE_ROLE_KEY o ANON_KEY)',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Verificar sesión del invocador
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
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Verificar permisos (misma lógica que invite-user)
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: prof, error: profErr } = await adminClient
      .from('user_profiles')
      .select('es_admin_sistema, area_id')
      .eq('id', user.id)
      .maybeSingle()

    if (profErr || !prof) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    let puedeInvitar = prof.es_admin_sistema === true
    if (!puedeInvitar && prof.area_id != null) {
      const { data: areaRow } = await adminClient
        .from('areas')
        .select('clave')
        .eq('id', prof.area_id)
        .maybeSingle()
      const cl = areaRow?.clave
      puedeInvitar =
        cl === 'TALENTO_HUMANO' ||
        cl === 'DIR_OPERATIVA' ||
        cl === 'ADMINISTRACION'
    }

    if (!puedeInvitar) {
      return new Response(JSON.stringify({ error: 'No autorizado' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = (await req.json()) as { email?: string; redirectTo?: string }
    const email = body.email?.trim()
    if (!email) {
      return new Response(JSON.stringify({ error: 'email requerido' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const redirectTo = body.redirectTo?.trim() || undefined
    if (redirectTo) {
      try {
        const u = new URL(redirectTo)
        if (u.protocol !== 'http:' && u.protocol !== 'https:') {
          return new Response(JSON.stringify({ error: 'redirectTo debe ser http(s)' }), {
            status: 400,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          })
        }
      } catch {
        return new Response(JSON.stringify({ error: 'redirectTo no es una URL válida' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
    }

    // Generar link de invitación sin enviar correo
    const { data, error: linkErr } = await adminClient.auth.admin.generateLink({
      type: 'invite',
      email,
      options: { redirectTo },
    })

    if (linkErr) {
      const msg = linkErr.message.toLowerCase()
      if (msg.includes('already') && msg.includes('registered')) {
        return new Response(
          JSON.stringify({
            error: 'Ese correo ya tiene cuenta. Debe iniciar sesión o recuperar contraseña.',
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
      return new Response(
        JSON.stringify({ error: linkErr.message }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    let actionLink: string = data?.properties?.action_link ?? ''
    if (!actionLink) {
      return new Response(
        JSON.stringify({ error: 'No se pudo generar el enlace de invitación.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    // Reemplazar URL interna (kong / localhost) por la URL pública de Supabase.
    // generateLink() usa SUPABASE_URL del contenedor que en self-hosted es http://kong:8000.
    if (apiExternalUrl) {
      try {
        const linkUrl = new URL(actionLink)
        const externalUrl = new URL(apiExternalUrl)
        linkUrl.protocol = externalUrl.protocol
        linkUrl.host = externalUrl.host
        linkUrl.port = externalUrl.port
        actionLink = linkUrl.toString()
      } catch {
        // Si falla el parseo, intentar reemplazo simple del origen
        const internalOrigin = supabaseUrl.replace(/\/$/, '')
        if (actionLink.startsWith(internalOrigin)) {
          actionLink = apiExternalUrl + actionLink.slice(internalOrigin.length)
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, link: actionLink }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
