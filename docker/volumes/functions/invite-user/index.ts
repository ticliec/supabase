// Supabase Edge Function: invitación por correo (auth.admin.inviteUserByEmail)
//
// Supabase Cloud: supabase functions deploy invite-user
//
// Self-hosted (Docker / EasyPanel): `supabase functions deploy` NO sube código a tu servidor.
// Copia esta carpeta a volumes/functions/invite-user/ en el host, luego:
//   docker compose restart functions --no-deps
// (ver https://supabase.com/docs/guides/self-hosting/self-hosted-functions )
//
// En Dashboard → Authentication → URL Configuration: añade la URL de login en Redirect URLs.

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

    if (!supabaseUrl || !serviceKey || !anonKey) {
      return new Response(
        JSON.stringify({
          error:
            'Faltan variables de entorno (SUPABASE_URL, SERVICE_ROLE_KEY o ANON_KEY)',
        }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
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
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

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
        cl === 'TALENTO_HUMANO' || cl === 'DIR_OPERATIVA'
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

    const { error: inviteErr } = await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo,
    })

    if (inviteErr) {
      return new Response(JSON.stringify({ error: inviteErr.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    return new Response(JSON.stringify({ ok: true }), {
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
