// Supabase Edge Function: notify-kiosk-chat-telegram
// Envía notificación por Telegram al técnico TIC encargado cuando se inicia
// un chat de soporte desde un kiosk de asistencia.
//
// Secrets requeridos:
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//   - ERP_FRONTEND_URL (base URL del frontend, ej: https://orbita.liec.mx)
//
// Usa la tabla config_telegram para el bot_token y tecnicos_soporte.telegram_chat_id
// para determinar a quién enviar.
//
// POST body:
// {
//   "session_id": "uuid",
//   "kiosk_device_id": number,
//   "kiosk_nombre": string,
//   "mensaje_inicial"?: string
// }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
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
      console.error(`[notify-kiosk-chat-telegram] Telegram API error: ${err}`)
      return false
    }
    return true
  } catch (err) {
    console.error(`[notify-kiosk-chat-telegram] Telegram fetch error: ${err}`)
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
    const supabaseUrl = (Deno.env.get('SUPABASE_URL') ?? '').trim().replace(/\/$/, '')
    const serviceRoleKey = (
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ??
      Deno.env.get('SERVICE_ROLE_KEY') ??
      ''
    ).trim()
    const frontendUrl = (Deno.env.get('ERP_FRONTEND_URL') ?? 'https://orbita.liec.mx').replace(/\/$/, '')

    if (!supabaseUrl || !serviceRoleKey) {
      console.error('[notify-kiosk-chat-telegram] Missing SUPABASE_URL or SERVICE_ROLE_KEY')
      return jsonResponse({ error: 'Configuración del servidor incompleta.' }, 500)
    }

    const supabase = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Obtener bot_token desde config_telegram
    const { data: configTg } = await supabase
      .from('config_telegram')
      .select('bot_token, activo')
      .eq('id', 1)
      .maybeSingle()

    if (!configTg?.bot_token || !configTg.activo) {
      console.error('[notify-kiosk-chat-telegram] Bot de Telegram no configurado o inactivo')
      return jsonResponse({ error: 'Bot de Telegram no configurado.' }, 500)
    }

    const botToken = configTg.bot_token

    // Parse body
    const body = await req.json()
    const { session_id, kiosk_device_id, kiosk_nombre, mensaje_inicial } = body as {
      session_id: string
      kiosk_device_id: number
      kiosk_nombre?: string
      mensaje_inicial?: string
    }

    if (!session_id || !kiosk_device_id) {
      return jsonResponse({ error: 'Faltan campos requeridos: session_id, kiosk_device_id.' }, 400)
    }

    // Buscar al técnico TIC con telegram_chat_id = 1460560534
    // (usuario encargado de este servicio)
    const targetChatId = '1460560534'

    // Verificar que existe en tecnicos_soporte
    const { data: tecnico } = await supabase
      .from('tecnicos_soporte')
      .select('nombre_completo, telegram_chat_id')
      .eq('telegram_chat_id', targetChatId)
      .eq('activo', true)
      .maybeSingle()

    if (!tecnico) {
      // Fallback: enviar directamente al chat_id conocido aunque no lo encontremos en la tabla
      console.warn('[notify-kiosk-chat-telegram] Técnico no encontrado en tabla, usando chat_id directo')
    }

    // Construir el link al chat de soporte
    const chatLink = `${frontendUrl}/equipamiento/tickets/kiosk-chat/${session_id}`

    // Construir mensaje
    const deviceName = kiosk_nombre || `Kiosk #${kiosk_device_id}`
    let messageText = `🆘 <b>Solicitud de ayuda — Kiosk</b>\n\n`
    messageText += `📍 <b>Dispositivo:</b> ${deviceName}\n`
    messageText += `🕐 <b>Hora:</b> ${new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}\n`

    if (mensaje_inicial) {
      messageText += `\n💬 <b>Mensaje:</b>\n${mensaje_inicial.slice(0, 300)}\n`
    }

    messageText += `\n🔗 <a href="${chatLink}">Abrir chat de soporte</a>`

    // Enviar notificación por Telegram
    const sent = await sendTelegramMessage(targetChatId, messageText, botToken)

    return jsonResponse({
      success: sent,
      telegram_sent: sent,
      chat_link: chatLink,
    })
  } catch (err) {
    console.error(`[notify-kiosk-chat-telegram] Unhandled error: ${err}`)
    return jsonResponse({ error: 'Error interno.' }, 500)
  }
})
