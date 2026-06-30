// Supabase Edge Function: notify-visita-telegram
// Envía notificaciones por Telegram cuando se asigna una visita o ruta.
//
// Secrets requeridos:
//   - TELEGRAM_BOT_TOKEN (token del bot de Telegram para DN)
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   - ERP_FRONTEND_URL (base URL del frontend, ej: https://orbita.liec.mx)
//
// POST body:
// {
//   "type": "visita" | "ruta",
//   "visita_id"?: string,     // si type=visita
//   "ruta_id"?: string,       // si type=ruta
//   "asignado_uid": string,   // user_id del asignado
//   "mensaje"?: string        // mensaje adicional opcional
// }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': Deno.env.get('ERP_FRONTEND_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function sendTelegramMessage(chatId: string, text: string, botToken: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: false,
      }),
    })
    if (!res.ok) {
      const err = await res.text()
      console.error(`[notify-visita-telegram] Telegram API error: ${err}`)
      return false
    }
    return true
  } catch (err) {
    console.error(`[notify-visita-telegram] Telegram fetch error: ${err}`)
    return false
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Método no permitido.' }, 405)
  }

  try {
    // Validate auth
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonResponse({ error: 'No autorizado.' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN_DN') ?? ''
    const frontendUrl = Deno.env.get('ERP_FRONTEND_URL') ?? 'https://orbita.liec.mx'

    if (!botToken) {
      console.error('[notify-visita-telegram] TELEGRAM_BOT_TOKEN_DN not configured')
      return jsonResponse({ error: 'Bot de Telegram no configurado.' }, 500)
    }

    // Parse body
    const body = await req.json()
    const { type, visita_id, ruta_id, asignado_uid, mensaje } = body as {
      type: 'visita' | 'ruta'
      visita_id?: string
      ruta_id?: string
      asignado_uid: string
      mensaje?: string
    }

    if (!type || !asignado_uid) {
      return jsonResponse({ error: 'Faltan campos requeridos: type, asignado_uid.' }, 400)
    }

    // Get service client
    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Get Telegram chat_id of the assigned user
    const { data: personalDN } = await supabase
      .from('prospeccion_personal_dn')
      .select('telegram_chat_id, nombre_completo')
      .eq('user_id', asignado_uid)
      .eq('activo', true)
      .single()

    if (!personalDN?.telegram_chat_id) {
      return jsonResponse({
        success: false,
        reason: 'El usuario asignado no tiene Telegram vinculado.',
      })
    }

    // Build message based on type
    let messageText = ''

    if (type === 'visita' && visita_id) {
      // Get visita details
      const { data: visita } = await supabase
        .from('prospeccion_visitas')
        .select('fecha, tipo_visita, objetivo, ubicacion')
        .eq('id', visita_id)
        .single()

      const link = `${frontendUrl}/ofertas/prospeccion/mis-visitas`
      messageText = `🗓 <b>Nueva Visita Asignada</b>\n\n`
      messageText += `📅 Fecha: ${visita?.fecha ?? 'Sin fecha'}\n`
      messageText += `📋 Tipo: ${visita?.tipo_visita ?? '—'}\n`
      messageText += `🎯 Objetivo: ${visita?.objetivo ?? '—'}\n`
      if (visita?.ubicacion) messageText += `📍 Ubicación: ${visita.ubicacion}\n`
      if (mensaje) messageText += `\n💬 ${mensaje}\n`
      messageText += `\n🔗 <a href="${link}">Ver mis visitas</a>`

    } else if (type === 'ruta' && ruta_id) {
      // Get ruta details
      const { data: ruta } = await supabase
        .from('prospeccion_rutas')
        .select('nombre, fecha_inicio, fecha_fin, descripcion')
        .eq('id', ruta_id)
        .single()

      // Count visitas in ruta
      const { count } = await supabase
        .from('prospeccion_visitas')
        .select('id', { count: 'exact', head: true })
        .eq('ruta_id', ruta_id)

      const link = `${frontendUrl}/ofertas/prospeccion/mis-visitas/${ruta_id}`
      messageText = `🗺 <b>Nueva Ruta Asignada</b>\n\n`
      messageText += `📌 Ruta: ${ruta?.nombre ?? '—'}\n`
      messageText += `📅 Periodo: ${ruta?.fecha_inicio ?? '?'} al ${ruta?.fecha_fin ?? '?'}\n`
      messageText += `📋 Visitas: ${count ?? 0}\n`
      if (ruta?.descripcion) messageText += `📝 ${ruta.descripcion}\n`
      if (mensaje) messageText += `\n💬 ${mensaje}\n`
      messageText += `\n🔗 <a href="${link}">Ver ruta completa</a>`

    } else {
      return jsonResponse({ error: 'Tipo inválido o falta id.' }, 400)
    }

    // Send Telegram message
    const sent = await sendTelegramMessage(personalDN.telegram_chat_id, messageText, botToken)

    return jsonResponse({
      success: sent,
      telegram_sent: sent,
      nombre_asignado: personalDN.nombre_completo,
    })

  } catch (err) {
    console.error(`[notify-visita-telegram] Unhandled error: ${err}`)
    return jsonResponse({ error: 'Error interno.' }, 500)
  }
})
