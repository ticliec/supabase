// Supabase Edge Function: chat-tickets
// Proxy seguro hacia OpenAI GPT-4o-mini para el chatbot de tickets.
//
// Supabase Cloud: supabase functions deploy chat-tickets
// Self-hosted: copiar a volumes/functions/chat-tickets/ y reiniciar.
//
// Secrets requeridos:
//   - OPENAI_API_KEY
//   - SUPABASE_URL, SUPABASE_ANON_KEY (automáticos en Supabase Cloud)
//   - ERP_FRONTEND_ORIGIN (opcional, default '*')

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

// ── CORS ─────────────────────────────────────────────────────────────────────

const allowedOrigin = Deno.env.get('ERP_FRONTEND_ORIGIN') ?? '*'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': allowedOrigin,
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ── Rate Limiting (in-memory, per-instance) ──────────────────────────────────

const rateLimitMap = new Map<string, number[]>()
const RATE_LIMIT_MAX = 10
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute

function isRateLimited(userId: string): boolean {
  const now = Date.now()
  const timestamps = rateLimitMap.get(userId) ?? []

  // Remove timestamps outside the window
  const recent = timestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS)

  if (recent.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(userId, recent)
    return true
  }

  recent.push(now)
  rateLimitMap.set(userId, recent)
  return false
}

// ── System Prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres un asistente de soporte técnico y de infraestructura amigable y profesional para la empresa LIEC. Responde siempre en español.

Tu objetivo es ayudar a los empleados a crear tickets de soporte. Sigue este flujo:

1. **Saludo y recopilación**: Saluda al usuario y pídele que describa su problema o necesidad con el mayor detalle posible.

2. **Clasificación automática**: Analiza la descripción y determina:
   - **Área** (area): TIC o INFRAESTRUCTURA
   - **Clasificación** (clasificacion): una de las opciones válidas para el área detectada
   - **Prioridad** (prioridad): BAJA, MEDIA o ALTA según la urgencia

3. **Áreas y clasificaciones válidas**:
   - **TIC**: SOFTWARE, HARDWARE, RED, CORREO, ERP, OTRO
   - **INFRAESTRUCTURA**: AGUA, DRENAJE, ELECTRICIDAD, MOBILIARIO, LIMPIEZA, OTRO

4. **Criterios de prioridad**:
   - **ALTA**: Afecta a múltiples usuarios, detiene operaciones críticas, riesgo de seguridad, fuga de agua/gas, falla eléctrica peligrosa
   - **MEDIA**: Afecta el trabajo de un usuario o equipo, degradación de servicio, problema recurrente
   - **BAJA**: Solicitud de mejora, problema menor que tiene solución temporal, mantenimiento preventivo

5. **Presentar resumen**: Muestra al usuario un resumen estructurado con los datos del ticket y explica brevemente por qué elegiste esa clasificación y prioridad. Pregunta si los datos son correctos y pide confirmación explícita.

6. **Confirmación**: SOLO cuando el usuario confirme explícitamente (por ejemplo: "sí", "confirmo", "correcto", "de acuerdo", "adelante"), genera el bloque JSON con ticket_data y confirmado: true.

7. **Formato de salida con confirmación**: Cuando el usuario confirme, incluye en tu respuesta un bloque JSON con exactamente esta estructura:
\`\`\`json
{
  "ticket_data": {
    "descripcion": "Descripción detallada del problema (mínimo 10 caracteres)",
    "area": "TIC o INFRAESTRUCTURA",
    "clasificacion": "Clasificación válida para el área",
    "prioridad": "BAJA, MEDIA o ALTA",
    "confirmado": true
  }
}
\`\`\`

8. **Casos especiales**:
   - Si la descripción es ambigua o muy corta, haz preguntas de aclaración antes de clasificar.
   - Si el usuario habla de temas no relacionados con soporte técnico o infraestructura, redirige amablemente la conversación.
   - Si el usuario quiere corregir algún dato (área, clasificación o prioridad), acepta la corrección y presenta un nuevo resumen.
   - Si el usuario no confirma o dice que algo está mal, pregunta qué desea cambiar.

9. **Imágenes**: Recuerda al usuario que puede adjuntar imágenes o fotos para ilustrar mejor el problema. Esto ayuda a los técnicos a entender la situación más rápidamente.

10. **Reglas importantes**:
    - NUNCA generes el bloque JSON de ticket_data sin confirmación explícita del usuario.
    - NUNCA uses clasificaciones que no estén en la lista válida para el área.
    - Sé conciso pero amable en tus respuestas.
    - Si no estás seguro del área o clasificación, pregunta al usuario.
    - Después de crear un ticket, ofrece ayuda para crear otro si lo necesita.`

// ── Types ────────────────────────────────────────────────────────────────────

type ChatMessage = {
  role: 'user' | 'assistant'
  content: string
}

type RequestBody = {
  messages: ChatMessage[]
  user_id: string
  user_name: string
}

type TicketDataResponse = {
  descripcion: string
  area: 'TIC' | 'INFRAESTRUCTURA'
  clasificacion: string
  prioridad: 'BAJA' | 'MEDIA' | 'ALTA'
  confirmado: boolean
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function jsonResponse(
  body: Record<string, unknown>,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

/** Extract ticket_data from the AI response text if present. */
function extractTicketData(text: string): TicketDataResponse | undefined {
  // Try ```json block first
  const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)```/)
  if (jsonBlockMatch) {
    const parsed = tryParseTicketData(jsonBlockMatch[1].trim())
    if (parsed) return parsed
  }

  // Try inline JSON
  const inlineMatch = text.match(/\{[\s\S]*\}/)
  if (inlineMatch) {
    const parsed = tryParseTicketData(inlineMatch[0])
    if (parsed) return parsed
  }

  return undefined
}

function tryParseTicketData(jsonStr: string): TicketDataResponse | undefined {
  try {
    const data = JSON.parse(jsonStr)
    // Handle both { ticket_data: {...} } and direct {...} formats
    const td = data.ticket_data ?? data

    const validAreas = ['TIC', 'INFRAESTRUCTURA']
    const validClasificaciones: Record<string, string[]> = {
      TIC: ['SOFTWARE', 'HARDWARE', 'RED', 'CORREO', 'ERP', 'OTRO'],
      INFRAESTRUCTURA: ['AGUA', 'DRENAJE', 'ELECTRICIDAD', 'MOBILIARIO', 'LIMPIEZA', 'OTRO'],
    }
    const validPrioridades = ['BAJA', 'MEDIA', 'ALTA']

    if (
      typeof td.descripcion === 'string' &&
      td.descripcion.length >= 10 &&
      validAreas.includes(td.area) &&
      validClasificaciones[td.area]?.includes(td.clasificacion) &&
      validPrioridades.includes(td.prioridad) &&
      typeof td.confirmado === 'boolean'
    ) {
      return {
        descripcion: td.descripcion,
        area: td.area,
        clasificacion: td.clasificacion,
        prioridad: td.prioridad,
        confirmado: td.confirmado,
      }
    }
  } catch {
    // Not valid JSON
  }
  return undefined
}

function validateRequestBody(body: unknown): body is RequestBody {
  if (body === null || typeof body !== 'object') return false
  const obj = body as Record<string, unknown>

  if (!Array.isArray(obj.messages)) return false
  if (typeof obj.user_id !== 'string' || obj.user_id.length === 0) return false
  if (typeof obj.user_name !== 'string') return false

  // Validate each message has role and content
  for (const msg of obj.messages) {
    if (typeof msg !== 'object' || msg === null) return false
    const m = msg as Record<string, unknown>
    if (m.role !== 'user' && m.role !== 'assistant') return false
    if (typeof m.content !== 'string') return false
  }

  return true
}

// ── Main Handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  // Only accept POST
  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Método no permitido.' }, 405)
  }

  try {
    // ── 1. Validate JWT ────────────────────────────────────────────────────

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return jsonResponse({ error: 'No autorizado.' }, 401)
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? ''
    const anonKey =
      Deno.env.get('SUPABASE_ANON_KEY') ?? Deno.env.get('ANON_KEY') ?? ''

    if (!supabaseUrl || !anonKey) {
      console.error('[chat-tickets] Missing SUPABASE_URL or ANON_KEY')
      return jsonResponse({ error: 'Error interno del servidor.' }, 500)
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
      return jsonResponse({ error: 'No autorizado.' }, 401)
    }

    // ── 2. Parse and validate request body ─────────────────────────────────

    let body: unknown
    try {
      body = await req.json()
    } catch {
      return jsonResponse({ error: 'Solicitud inválida.' }, 400)
    }

    if (!validateRequestBody(body)) {
      return jsonResponse({ error: 'Solicitud inválida.' }, 400)
    }

    const { messages, user_id, user_name } = body

    // ── 3. Rate limiting ───────────────────────────────────────────────────

    if (isRateLimited(user_id)) {
      return jsonResponse(
        { error: 'Demasiadas solicitudes. Espera un momento.' },
        429,
      )
    }

    // ── 4. Get OpenAI API key ──────────────────────────────────────────────

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiApiKey) {
      console.error('[chat-tickets] OPENAI_API_KEY not configured')
      return jsonResponse({ error: 'Error interno del servidor.' }, 500)
    }

    // ── 5. Prepare messages for OpenAI ─────────────────────────────────────

    // Truncate to last 20 messages
    const recentMessages = messages.slice(-20)

    const openaiMessages = [
      {
        role: 'system' as const,
        content: `${SYSTEM_PROMPT}\n\nEl usuario se llama ${user_name}.`,
      },
      ...recentMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ]

    // ── 6. Call OpenAI API with 30s timeout ────────────────────────────────

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 30_000)

    let openaiResponse: Response

    try {
      openaiResponse = await fetch(
        'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${openaiApiKey}`,
          },
          body: JSON.stringify({
            model: 'gpt-4o-mini',
            messages: openaiMessages,
            temperature: 0.7,
            max_tokens: 1024,
          }),
          signal: controller.signal,
        },
      )
    } catch (err) {
      clearTimeout(timeoutId)
      const isAbort =
        err instanceof DOMException && err.name === 'AbortError'
      if (isAbort) {
        console.error(
          `[chat-tickets] OpenAI timeout | user=${user_id} ts=${new Date().toISOString()}`,
        )
      } else {
        console.error(
          `[chat-tickets] OpenAI fetch error | user=${user_id} ts=${new Date().toISOString()} err=${err}`,
        )
      }
      return jsonResponse(
        { error: 'El servicio de IA no está disponible.' },
        502,
      )
    }

    clearTimeout(timeoutId)

    if (!openaiResponse.ok) {
      const errBody = await openaiResponse.text().catch(() => 'unknown')
      console.error(
        `[chat-tickets] OpenAI error ${openaiResponse.status} | user=${user_id} ts=${new Date().toISOString()} body=${errBody}`,
      )
      return jsonResponse(
        { error: 'El servicio de IA no está disponible.' },
        502,
      )
    }

    // ── 7. Parse OpenAI response ───────────────────────────────────────────

    const openaiData = await openaiResponse.json()
    const choice = openaiData.choices?.[0]
    const assistantMessage: string =
      choice?.message?.content ?? 'Lo siento, no pude generar una respuesta.'

    // ── 8. Log metadata (no conversation content) ──────────────────────────

    const usage = openaiData.usage
    console.log(
      `[chat-tickets] user=${user_id} ts=${new Date().toISOString()} prompt_tokens=${usage?.prompt_tokens ?? '?'} completion_tokens=${usage?.completion_tokens ?? '?'} total_tokens=${usage?.total_tokens ?? '?'}`,
    )

    // ── 9. Extract ticket_data if present ──────────────────────────────────

    const ticketData = extractTicketData(assistantMessage)

    // ── 10. Build and return response ──────────────────────────────────────

    const responseBody: Record<string, unknown> = {
      message: assistantMessage,
    }

    if (ticketData) {
      responseBody.ticket_data = ticketData
    }

    return jsonResponse(responseBody)
  } catch (err) {
    console.error(
      `[chat-tickets] Unhandled error: ${err instanceof Error ? err.message : String(err)}`,
    )
    return jsonResponse({ error: 'Error interno del servidor.' }, 500)
  }
})
