// Supabase Edge Function: eliminar cuenta de usuario (auth.admin.deleteUser)
// Solo accesible para administradores de sistema (es_admin_sistema = true).
//
// Acepta { userId } O { email } para localizar la cuenta auth.
// Limpia TODAS las referencias FK a auth.users antes de eliminar.
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
      const { data: targetUser, error: targetErr } = await adminClient.auth.admin.getUserById(targetUserId)
      if (targetErr || !targetUser?.user) {
        return new Response(JSON.stringify({ error: 'Usuario no encontrado en auth' }), {
          status: 404,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        })
      }
      targetEmail = targetUser.user.email ?? null
    } else if (inputEmail) {
      // Buscar usuario por email paginando
      let found: { id: string; email?: string } | null = null
      let page = 1
      while (!found) {
        const { data: listData, error: listErr } = await adminClient.auth.admin.listUsers({
          page,
          perPage: 100,
        })
        if (listErr || !listData?.users?.length) break
        const match = listData.users.find(
          (u) => u.email?.toLowerCase() === inputEmail.toLowerCase(),
        )
        if (match) {
          found = match
          break
        }
        if (listData.users.length < 100) break
        page++
      }

      if (!found) {
        return new Response(
          JSON.stringify({ error: `No existe cuenta auth con el correo: ${inputEmail}` }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
      targetUserId = found.id
      targetEmail = found.email ?? inputEmail
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

    // ═══════════════════════════════════════════════════════════════════
    // LIMPIAR TODAS las referencias FK a auth.users ANTES de eliminar
    // Usamos una función RPC que ejecuta todo en una transacción SQL.
    // Si la función no existe, hacemos las operaciones manualmente.
    // ═══════════════════════════════════════════════════════════════════

    // Intentar usar RPC si existe
    const { error: rpcErr } = await adminClient.rpc('admin_limpiar_referencias_usuario', {
      p_user_id: targetUserId,
      p_admin_id: user.id,
    })

    if (rpcErr) {
      // La función RPC no existe o falló; limpiar manualmente tabla por tabla
      const uid = targetUserId

      // Tablas donde DELETE es seguro (datos del usuario que ya no existirá)
      await adminClient.from('push_subscriptions').delete().eq('user_id', uid)
      await adminClient.from('notificaciones').delete().eq('user_id', uid)
      await adminClient.from('push_notifications_log').delete().eq('user_id', uid)
      await adminClient.from('comunidad_publicaciones_vistas').delete().eq('user_id', uid)
      await adminClient.from('comunidad_likes').delete().eq('user_id', uid)
      await adminClient.from('comunidad_comentarios').delete().eq('user_id', uid)

      // Tablas donde SET NULL en columnas FK (preservar el registro histórico)
      await adminClient.from('pdr_personal1').update({ uid: null }).eq('uid', uid)
      await adminClient.from('user_sucursales').delete().eq('user_id', uid)

      // calendario_eventos - eliminar eventos personales del usuario
      await adminClient.from('calendario_eventos').delete().eq('user_id', uid)

      // tareas - nullificar referencias
      await adminClient.from('tareas').update({ creado_por: user.id }).eq('creado_por', uid)
      await adminClient.from('tareas').update({ asignado_a: user.id }).eq('asignado_a', uid)

      // ausencias
      await adminClient.from('ausencias_historial_aprobacion').update({ aprobador_id: null }).eq('aprobador_id', uid)
      await adminClient.from('ausencias_solicitud').update({ revisado_por: null }).eq('revisado_por', uid)
      await adminClient.from('ausencias_solicitud').update({ created_by: null }).eq('created_by', uid)
      await adminClient.from('ausencias_solicitud').update({ aprobador_actual_id: null }).eq('aprobador_actual_id', uid)

      // tickets
      await adminClient.from('tickets').update({ asignado_id: null }).eq('asignado_id', uid)
      await adminClient.from('tickets').update({ solicitante_id: user.id }).eq('solicitante_id', uid)

      // solicitudes_equipo
      await adminClient.from('solicitudes_equipo').update({ solicitante_id: user.id }).eq('solicitante_id', uid)

      // horas_extra
      await adminClient.from('horas_extra').update({ aprobado_por: null }).eq('aprobado_por', uid)
      await adminClient.from('horas_extra').update({ registrado_por: user.id }).eq('registrado_por', uid)

      // descuentos_nomina
      await adminClient.from('descuentos_nomina').update({ generado_por: null }).eq('generado_por', uid)

      // operaciones_orbita - no eliminar (auditoría), reasignar al admin
      await adminClient.from('operaciones_orbita').update({ usuario_id: user.id }).eq('usuario_id', uid)

      // capacitación
      await adminClient.from('cap_asistentes').delete().eq('empleado_uid', uid)
      await adminClient.from('cap_certificados').delete().eq('empleado_uid', uid)
      await adminClient.from('cap_respuestas').delete().eq('empleado_uid', uid)

      // convocatorias y exámenes creados por el usuario
      await adminClient.from('cap_convocatorias').update({ creado_por: user.id }).eq('creado_por', uid)
      await adminClient.from('cap_examenes').update({ creado_por: user.id }).eq('creado_por', uid)
      await adminClient.from('cap_titulo_convocatorias').update({ creado_por: null }).eq('creado_por', uid)

      // comunidad_publicaciones - reasignar
      await adminClient.from('comunidad_publicaciones').update({ autor_user_id: user.id }).eq('autor_user_id', uid)

      // EPP
      await adminClient.from('epp_asignaciones').update({ empleado_id: user.id }).eq('empleado_id', uid)
      await adminClient.from('epp_asignaciones').update({ asignado_por_id: null }).eq('asignado_por_id', uid)
      await adminClient.from('epp_notificaciones_caducidad').update({ almacenista_id: null }).eq('almacenista_id', uid)

      // personal_documents
      await adminClient.from('personal_document_requests').delete().eq('employee_id', uid)
      await adminClient.from('personal_document_requests').update({ requested_by: user.id }).eq('requested_by', uid)
      await adminClient.from('personal_documents').update({ uploaded_by: user.id }).eq('uploaded_by', uid)
      await adminClient.from('personal_documents').update({ employee_id: user.id }).eq('employee_id', uid)

      // archivos
      await adminClient.from('directory_list_requests').delete().eq('requested_by', uid)
      await adminClient.from('file_download_requests').delete().eq('requested_by', uid)
      await adminClient.from('document_delivery_jobs').update({ created_by: null }).eq('created_by', uid)

      // psicometricos
      await adminClient.from('psicometricos_enlaces').update({ creado_por: user.id }).eq('creado_por', uid)
      await adminClient.from('psicometricos_enlaces').update({ vinculado_por: null }).eq('vinculado_por', uid)

      // calibraciones
      await adminClient.from('calibraciones').update({ created_by: null }).eq('created_by', uid)

      // contabilidad_terminaciones
      await adminClient.from('contabilidad_terminaciones').update({ calculado_por: null }).eq('calculado_por', uid)

      // sanciones_retardos
      await adminClient.from('sanciones_retardos').update({ generada_por: null }).eq('generada_por', uid)

      // tecnicos_soporte
      await adminClient.from('tecnicos_soporte').delete().eq('user_id', uid)

      // procuracion
      await adminClient.from('procuracion_evaluaciones').update({ created_by: null }).eq('created_by', uid)
      await adminClient.from('procuracion_requisiciones').update({ created_by: null }).eq('created_by', uid)

      // presupuesto
      await adminClient.from('presupuesto_periodos').update({ created_by: null }).eq('created_by', uid)
      await adminClient.from('presupuesto_amex').update({ created_by: null }).eq('created_by', uid)
      await adminClient.from('presupuesto_sb').update({ created_by: null }).eq('created_by', uid)
      await adminClient.from('presupuesto_sb_resico').update({ created_by: null }).eq('created_by', uid)

      // vacantes
      await adminClient.from('vacantes').update({ created_by: null }).eq('created_by', uid)

      // buzon_quejas
      await adminClient.from('buzon_quejas').update({ atendido_por: null }).eq('atendido_por', uid)
    }

    // Eliminar user_profiles (debe ir después de limpiar user_sucursales que tiene FK a user_profiles)
    await adminClient.from('user_profiles').delete().eq('id', targetUserId)

    // Eliminar usuario de auth.users
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
