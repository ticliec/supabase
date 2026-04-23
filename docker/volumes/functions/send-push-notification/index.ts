import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

serve(async (req) => {
  try {
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method not allowed' }), {
        status: 405,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    const payload = await req.json()
    const { userId, tipo, titulo, mensaje, url, icono, datos } = payload

    if (!userId || !titulo || !mensaje) {
      return new Response(
        JSON.stringify({ error: 'userId, titulo y mensaje son requeridos' }),
        { status: 400, headers: { 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(supabaseUrl, supabaseServiceKey)

    // Registrar en log
    await supabase.from('push_notifications_log').insert({
      user_id: userId,
      tipo,
      titulo,
      mensaje,
      url,
      datos,
      enviado: true,
    })

    return new Response(
      JSON.stringify({ ok: true, message: 'Notificación registrada' }),
      { status: 200, headers: { 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error('Error:', error)
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})