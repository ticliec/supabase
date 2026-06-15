// Supabase Edge Function: eliminar cuenta de usuario (auth.admin.deleteUser)
// Solo accesible para administradores de sistema (es_admin_sistema = true).
//
// Acepta { userId } O { email } para localizar la cuenta auth.
// Elimina el usuario de auth.users y limpia las referencias en user_profiles y pdr_personal1.
// NO elimina el registro de pdr_personal1 (nómina), solo desvincula el uid.
//
// Supabase Cloud: supabase functions deploy delete-user
// Self-hosted: copiar a volumes/functions/delete-user/ y reiniciar.

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

    // Solo admin de sistema puede eliminar cuentas
    const adminClient = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const { data: prof, error: profErr } = await adminClient
      .from('user_profiles')
      .select('es_admin_sistema')
      .eq('id', user.id)
      .maybeSingle()

    if (profErr || !prof || prof.es_admin_sistema !== true) {
      return new Response(JSON.stringify({ error: 'Solo administradores de sistema pueden eliminar cuentas' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body = (await req.json()) as { userId?: string; email?: string }
    const inputUserId = body.userId?.trim()
    const inputEmail = body.email?.trim()

    if (!inputUserId && !inputEmail) {
      return new Response(JSON.stringify({ error: 'Se requiere userId o email' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Resolver el userId del target
    let targetUserId: string | null = inputUserId || null
    let targetEmail: string | null = null

    if (targetUserId) {
      // Buscar por userId directamente
      const { data: targetUser, error: targetErr } = await adminClient.auth.admin.getUserById(targetUserId)
      if (targetErr || !targetUser?.user) {
        return new Response(JSON.stringify({ error: 'Usuario no encontrado en auth' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      targetEmail = targetUser.user.email ?? null
    } else if (inputEmail) {
      // Buscar usuario por email en auth.users usando listUsers con filtro
      // Supabase admin API no tiene getUserByEmail directamente, usamos listUsers
      const { data: listData, error: listErr } = await adminClient.auth.admin.listUsers({
        page: 1,
        perPage: 50,
      })

      if (listErr) {
        return new Response(JSON.stringify({ error: `Error al buscar usuarios: ${listErr.message}` }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }

      const found = listData.users.find(
        (u) => u.email?.toLowerCase() === inputEmail.toLowerCase(),
      )

      if (!found) {
        // Intentar con paginación si hay muchos usuarios
        let page = 2
        let foundUser = found
        while (!foundUser && listData.users.length === 50) {
          const { data: nextPage, error: nextErr } = await adminClient.auth.admin.listUsers({
            page,
            perPage: 50,
          })
          if (nextErr || !nextPage?.users?.length) break
          foundUser = nextPage.users.find(
            (u) => u.email?.toLowerCase() === inputEmail.toLowerCase(),
          )
          if (nextPage.users.length < 50) break
          page++
        }

        if (!foundUser) {
          return new Response(
            JSON.stringify({ error: `No existe cuenta auth con el correo: ${inputEmail}` }),
            { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
          )
        }
        targetUserId = foundUser.id
        targetEmail = foundUser.email ?? inputEmail
      } else {
        targetUserId = found.id
        targetEmail = found.email ?? inputEmail
      }
    }

    if (!targetUserId) {
      return new Response(JSON.stringify({ error: 'No se pudo resolver el usuario' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // No permitir auto-eliminación
    if (targetUserId === user.id) {
      return new Response(JSON.stringify({ error: 'No puedes eliminar tu propia cuenta' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // 1. Desvincular uid en pdr_personal1
    await adminClient
      .from('pdr_personal1')
      .update({ uid: null })
      .eq('uid', targetUserId)

    // 2. Eliminar user_profiles
    await adminClient
      .from('user_profiles')
      .delete()
      .eq('id', targetUserId)

    // 3. Eliminar push_subscriptions del usuario
    await adminClient
      .from('push_subscriptions')
      .delete()
      .eq('user_id', targetUserId)

    // 4. Eliminar usuario de auth.users
    const { error: deleteErr } = await adminClient.auth.admin.deleteUser(targetUserId)
    if (deleteErr) {
      return new Response(
        JSON.stringify({ error: `Error al eliminar cuenta auth: ${deleteErr.message}` }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
      )
    }

    return new Response(
      JSON.stringify({ ok: true, email: targetEmail }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
