// Supabase Edge Function: telegram-dn-webhook
// Webhook del bot de Telegram para DN (Desarrollo de Negocios).
// Maneja el comando /start con token de vinculación.
//
// Flujo de vinculación:
// 1. El admin genera un link de vinculación con token único (desde el ERP)
// 2. El usuario recibe el link por WhatsApp con instrucciones
// 3. El usuario abre el link que lo lleva al bot con /start {token}
// 4. Este webhook recibe el mensaje, valida el token, y vincula el chat_id
//
// Secrets requeridos:
//   - TELEGRAM_BOT_TOKEN_DN
//   - SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Para configurar el webhook en Telegram:
// curl -X POST "https://api.telegram.org/bot{TOKEN}/setWebhook" \
//   -d "url=https://{PROJECT_REF}.supabase.co/functions/v1/telegram-dn-webhook"

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

Deno.serve(async (req) => {
  if (req.method !== 'POST') {
    return new Response('OK', { status: 200 })
  }

  try {
    const botToken = Deno.env.get('TELEGRAM_BOT_TOKEN_DN') ?? ''
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    if (!botToken || !supabaseUrl || !serviceRoleKey) {
      console.error('[telegram-dn-webhook] Missing env vars')
      return new Response('OK', { status: 200 })
    }

    const update = await req.json()

    // Only handle messages
    const message = update?.message
    if (!message || !message.text) {
      return new Response('OK', { status: 200 })
    }

    const chatId = String(message.chat.id)
    const text = message.text.trim()
    const firstName = message.from?.first_name ?? 'Usuario'

    // Handle /start command with token
    if (text.startsWith('/start')) {
      const parts = text.split(' ')
      const token = parts[1]?.trim()

      if (!token) {
        // /start sin token — mensaje de bienvenida
        await sendMessage(chatId, botToken,
          `👋 ¡Hola ${firstName}!\n\n` +
          `Soy el bot de <b>Órbita LIEC — Desarrollo de Negocios</b>.\n\n` +
          `Para vincular tu cuenta, necesitas el enlace de invitación que te enviaron por WhatsApp.\n\n` +
          `Si ya lo tienes, haz clic en él y llegarás aquí automáticamente.`
        )
        return new Response('OK', { status: 200 })
      }

      // Validar token y vincular
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

      if (findErr || !pending) {
        await sendMessage(chatId, botToken,
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
        await sendMessage(chatId, botToken,
          `⚠️ Ocurrió un error al vincular tu cuenta. Intenta de nuevo o contacta al administrador.`
        )
        return new Response('OK', { status: 200 })
      }

      await sendMessage(chatId, botToken,
        `✅ <b>¡Vinculación exitosa!</b>\n\n` +
        `Hola <b>${pending.nombre_completo}</b>, tu cuenta de Telegram quedó vinculada a Órbita LIEC.\n\n` +
        `A partir de ahora recibirás notificaciones cuando te asignen visitas o rutas comerciales. 🗺`
      )
      return new Response('OK', { status: 200 })
    }

    // Cualquier otro mensaje
    await sendMessage(chatId, botToken,
      `ℹ️ Este bot solo envía notificaciones de visitas y rutas.\n` +
      `No puedo responder a mensajes. Si necesitas ayuda, contacta al área de DN.`
    )

    return new Response('OK', { status: 200 })
  } catch (err) {
    console.error(`[telegram-dn-webhook] Error: ${err}`)
    return new Response('OK', { status: 200 })
  }
})

async function sendMessage(chatId: string, botToken: string, text: string): Promise<void> {
  await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: 'HTML',
    }),
  })
}
