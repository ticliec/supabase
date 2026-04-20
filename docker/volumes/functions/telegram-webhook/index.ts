// Supabase Edge Function: telegram-webhook
// Webhook para el bot de Telegram.
// Cuando un técnico envía /start, vincula su chat_id con su cuenta.
//
// Flujo:
// 1. Técnico abre el bot en Telegram y envía /start
// 2. Telegram envía el update a este webhook
// 3. La función busca al técnico por email o nombre y vincula el chat_id
//
// Variables de entorno:
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function jsonResponse(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ ok: true }) // Telegram expects 200
  }

  try {
    const update = await req.json()
    const message = update?.message
    if (!message?.text || !message?.chat?.id) {
      return jsonResponse({ ok: true })
    }

    const chatId = String(message.chat.id)
    const text = message.text.trim()
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceKey = Deno.env.get('SERVICE_ROLE_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    if (!supabaseUrl || !serviceKey) {
      console.error('[telegram-webhook] Missing env vars')
      return jsonResponse({ ok: true })
    }

    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    // Get bot token for replies
    const { data: config } = await supabase
      .from('config_telegram')
      .select('bot_token')
      .eq('id', 1)
      .single()

    const botToken = config?.bot_token

    async function reply(replyText: string) {
      if (!botToken) return
      await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: replyText,
          parse_mode: 'HTML',
        }),
      })
    }

    // ── /start command ─────────────────────────────────────────────────
    if (text === '/start') {
      // Check if this chat_id is already linked
      const { data: existing } = await supabase
        .from('tecnicos_soporte')
        .select('nombre_completo')
        .eq('telegram_chat_id', chatId)
        .limit(1)

      if (existing && existing.length > 0) {
        await reply(
          `✅ Ya estás vinculado como <b>${existing[0].nombre_completo}</b>.\n\nRecibirás notificaciones de tickets aquí.`
        )
        return jsonResponse({ ok: true })
      }

      await reply(
        '👋 ¡Hola! Soy el bot de soporte de LIEC.\n\n'
        + 'Para vincular tu cuenta, envía tu correo corporativo:\n\n'
        + '<code>/vincular tucorreo@liec.com.mx</code>'
      )
      return jsonResponse({ ok: true })
    }

    // ── /vincular command ──────────────────────────────────────────────
    if (text.startsWith('/vincular ')) {
      const email = text.replace('/vincular ', '').trim().toLowerCase()

      if (!email.includes('@')) {
        await reply('❌ Correo no válido. Usa: <code>/vincular tucorreo@liec.com.mx</code>')
        return jsonResponse({ ok: true })
      }

      // Find user by email in user_profiles
      const { data: profile } = await supabase
        .from('user_profiles')
        .select('id, nombre_completo')
        .ilike('email', email)
        .single()

      if (!profile) {
        await reply('❌ No se encontró una cuenta con ese correo en el sistema.')
        return jsonResponse({ ok: true })
      }

      // Check if user is a technician
      const { data: tecnico, error: tecErr } = await supabase
        .from('tecnicos_soporte')
        .select('id, nombre_completo, telegram_chat_id')
        .eq('user_id', profile.id)
        .single()

      if (tecErr || !tecnico) {
        await reply('❌ Tu cuenta no está registrada como técnico de soporte. Contacta a tu coordinador.')
        return jsonResponse({ ok: true })
      }

      // Link chat_id
      const { error: updateErr } = await supabase
        .from('tecnicos_soporte')
        .update({ telegram_chat_id: chatId })
        .eq('id', tecnico.id)

      if (updateErr) {
        console.error('[telegram-webhook] Update error:', updateErr.message)
        await reply('❌ Error al vincular. Intenta de nuevo.')
        return jsonResponse({ ok: true })
      }

      await reply(
        `✅ ¡Vinculado exitosamente!\n\n`
        + `<b>Nombre:</b> ${tecnico.nombre_completo}\n`
        + `<b>Correo:</b> ${email}\n\n`
        + `Recibirás notificaciones de tickets asignados aquí. 🎫`
      )
      return jsonResponse({ ok: true })
    }

    // ── /estado command ────────────────────────────────────────────────
    if (text === '/estado') {
      const { data: tecnico } = await supabase
        .from('tecnicos_soporte')
        .select('nombre_completo, area, activo')
        .eq('telegram_chat_id', chatId)
        .single()

      if (!tecnico) {
        await reply('No estás vinculado. Usa <code>/vincular tucorreo@liec.com.mx</code>')
        return jsonResponse({ ok: true })
      }

      // Count active tickets
      const { count } = await supabase
        .from('tickets')
        .select('id', { count: 'exact', head: true })
        .eq('asignado_id', chatId)
        .in('estatus', ['PENDIENTE', 'EN_PROGRESO'])

      await reply(
        `📊 <b>Tu estado</b>\n\n`
        + `<b>Nombre:</b> ${tecnico.nombre_completo}\n`
        + `<b>Área:</b> ${tecnico.area}\n`
        + `<b>Activo:</b> ${tecnico.activo ? 'Sí' : 'No'}\n`
        + `<b>Tickets activos:</b> ${count ?? '?'}`
      )
      return jsonResponse({ ok: true })
    }

    // ── Unknown command ────────────────────────────────────────────────
    if (text.startsWith('/')) {
      await reply(
        '📋 <b>Comandos disponibles:</b>\n\n'
        + '/start — Iniciar\n'
        + '/vincular correo@liec.com.mx — Vincular cuenta\n'
        + '/estado — Ver tu estado\n'
      )
      return jsonResponse({ ok: true })
    }

    // Non-command messages — ignore
    return jsonResponse({ ok: true })
  } catch (err) {
    console.error('[telegram-webhook] Error:', err)
    return jsonResponse({ ok: true }) // Always return 200 to Telegram
  }
})
