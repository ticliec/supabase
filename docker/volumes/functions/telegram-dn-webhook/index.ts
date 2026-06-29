// Supabase Edge Function: telegram-dn-webhook
// Webhook del bot de Telegram para DN (Desarrollo de Negocios).
// Maneja el comando /start con token de vinculación.
//
// Secrets requeridos:
//   - TELEGRAM_BOT_TOKEN_DN
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Para configurar el webhook en Telegram:
// curl -X POST "https://api.telegram.org/bot{TOKEN}/setWebhook" \
//   -d "url=https://{HOST}/functions/v1/telegram-dn-webhook"

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('OK', { status: 200 })
  }

  try {
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN_DN') ?? Deno.env.get('TELEGRAM_BOT_TOKEN') ?? ''
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    console.log(`[telegram-dn-webhook] botToken present: ${Boolean(botToken)}, supabaseUrl: ${supabaseUrl ? 'yes' : 'no'}, serviceKey: ${Boolean(serviceRoleKey)}`)

    if (!botToken) {
      console.error('[telegram-dn-webhook] TELEGRAM_BOT_TOKEN_DN not found in env')
      return new Response('OK', { status: 200 })
    }

    const update = await req.json()
    console.log(`[telegram-dn-webhook] Update received:`, JSON.stringify(update).slice(0, 500))

    // Only handle messages
    const message = update?.message
    if (!message || !message.text) {
      return new Response('OK', { status: 200 })
    }

    const chatId = String(message.chat.id)
    const text = message.text.trim()
    const firstName = message.from?.first_name ?? 'Usuario'

    console.log(`[telegram-dn-webhook] Message from chat ${chatId}: "${text}"`)

    // Handle /start command with token
    if (text.startsWith('/start')) {
      const parts = text.split(' ')
      const token = parts[1]?.trim()

      if (!token) {
        // /start sin token — mensaje de bienvenida
        await sendTelegram(chatId, botToken,
          `👋 ¡Hola ${firstName}!\n\n` +
          `Soy el bot de Órbita LIEC — Desarrollo de Negocios.\n\n` +
          `Para vincular tu cuenta, necesitas el enlace de invitación que te enviaron por WhatsApp.\n\n` +
          `Si ya lo tienes, haz clic en él y llegarás aquí automáticamente.`
        )
        return new Response('OK', { status: 200 })
      }

      // Token proporcionado — validar y vincular
      if (!supabaseUrl || !serviceRoleKey) {
        console.error('[telegram-dn-webhook] Missing SUPABASE_URL or SERVICE_ROLE_KEY')
        await sendTelegram(chatId, botToken, `⚠️ Error interno del servidor. Contacta al administrador.`)
        return new Response('OK', { status: 200 })
      }

      const supabase = createClient(supabaseUrl, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })

      // Buscar token pendiente en la tabla
      const { data: pending, error: findErr } = await supabase
        .from('prospeccion_personal_dn')
        .select('id, nombre_completo, telegram_chat_id')
        .eq('telegram_vinculacion_token', token)
        .is('telegram_chat_id', null)
        .single()

      console.log(`[telegram-dn-webhook] Token lookup: token=${token}, found=${Boolean(pending)}, error=${findErr?.message ?? 'none'}`)

      if (findErr || !pending) {
        await sendTelegram(chatId, botToken,
          `❌ El enlace de vinculación no es válido o ya fue utilizado.\n\n` +
          `Solicita uno nuevo al área de Desarrollo de Negocios.`
        )
        return new Response('OK', { status: 200 })
      }

      // Vincular chat_id
      const { error: updateErr } = await supabase
        .from('prospeccion_personal_dn')
        .update({
          telegram_chat_id: chatId,
          telegram_vinculado_at: new Date().toISOString(),
          telegram_vinculacion_token: null, // Invalidar token
        })
        .eq('id', pending.id)

      if (updateErr) {
        console.error('[telegram-dn-webhook] Update error:', updateErr.message)
        await sendTelegram(chatId, botToken,
          `⚠️ Ocurrió un error al vincular tu cuenta. Intenta de nuevo o contacta al administrador.`
        )
        return new Response('OK', { status: 200 })
      }

      console.log(`[telegram-dn-webhook] Successfully linked chat ${chatId} to ${pending.nombre_completo}`)
      await sendTelegram(chatId, botToken,
        `✅ ¡Vinculación exitosa!\n\n` +
        `Hola ${pending.nombre_completo}, tu cuenta de Telegram quedó vinculada a Órbita LIEC.\n\n` +
        `A partir de ahora recibirás notificaciones cuando te asignen visitas o rutas comerciales. 🗺`
      )
      return new Response('OK', { status: 200 })
    }

    // Cualquier otro mensaje
    await sendTelegram(chatId, botToken,
      `ℹ️ Este bot solo envía notificaciones de visitas y rutas.\n` +
      `No puedo responder a mensajes. Si necesitas ayuda, contacta al área de DN.`
    )

    return new Response('OK', { status: 200 })
  } catch (err) {
    console.error(`[telegram-dn-webhook] Unhandled error: ${err}`)
    return new Response('OK', { status: 200 })
  }
})

async function sendTelegram(chatId: string, botToken: string, text: string): Promise<void> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'HTML',
      }),
    })
    const body = await res.text()
    console.log(`[telegram-dn-webhook] sendMessage response: ${res.status} ${body.slice(0, 200)}`)
  } catch (err) {
    console.error(`[telegram-dn-webhook] sendMessage failed: ${err}`)
  }
}
