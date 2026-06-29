// Supabase Edge Function: chat-tickets
// Proxy seguro hacia OpenAI GPT-4o-mini para el chatbot de tickets.
//
// Clasificaciones y técnicos se cargan DINÁMICAMENTE desde la DB en cada request.
// Esto elimina la desincronización entre el prompt de la IA y el catálogo real.
//
// Supabase Cloud: supabase functions deploy chat-tickets
// Self-hosted: copiar a volumes/functions/chat-tickets/ y reiniciar.
//
// Secrets requeridos:
//   - OPENAI_API_KEY
//   - SUPABASE_URL, SUPABASE_ANON_KEY (automáticos en Supabase Cloud)
//   - SUPABASE_SERVICE_ROLE_KEY (para leer clasificaciones/técnicos sin RLS)
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
  const recent = timestamps.filter((ts) => now - ts < RATE_LIMIT_WINDOW_MS)

  if (recent.length >= RATE_LIMIT_MAX) {
    rateLimitMap.set(userId, recent)
    return true
  }

  recent.push(now)
  rateLimitMap.set(userId, recent)
  return false
}

// ── In-memory cache for classifications + technicians ────────────────────────
// Cached per-instance to avoid querying DB on every single message.
// TTL: 5 minutes. The Edge Function instance restarts on deploy anyway.

type ClasificacionCache = {
  area: string
  clave: string
  nombre: string
  contexto_chatbot: string | null
}

type TecnicoCache = {
  nombre_completo: string
  area: string
  especializaciones: string[]
}

type CatalogCache = {
  clasificaciones: ClasificacionCache[]
  tecnicos: TecnicoCache[]
  timestamp: number
}

let catalogCache: CatalogCache | null = null
const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

async function loadCatalog(serviceClient: ReturnType<typeof createClient>): Promise<CatalogCache> {
  const now = Date.now()

  // Return cached if still fresh
  if (catalogCache && now - catalogCache.timestamp < CACHE_TTL_MS) {
    return catalogCache
  }

  // Fetch classifications and technicians in parallel
  const [clasifResult, tecnicosResult, especResult] = await Promise.all([
    serviceClient
      .from('ticket_clasificaciones')
      .select('area, clave, nombre, contexto_chatbot')
      .eq('activo', true)
      .order('area')
      .order('orden'),
    serviceClient
      .from('tecnicos_soporte')
      .select('id, nombre_completo, area')
      .eq('activo', true),
    serviceClient
      .from('tecnico_especializaciones')
      .select('tecnico_id, area, clasificacion'),
  ])

  const clasificaciones: ClasificacionCache[] = (clasifResult.data ?? []) as ClasificacionCache[]

  // Build technicians with their specializations
  const tecnicosRaw = (tecnicosResult.data ?? []) as { id: string; nombre_completo: string; area: string }[]
  const especRaw = (especResult.data ?? []) as { tecnico_id: string; area: string; clasificacion: string }[]

  // Map specializations by tecnico_id
  const especMap = new Map<string, string[]>()
  for (const e of especRaw) {
    const existing = especMap.get(e.tecnico_id) ?? []
    existing.push(e.clasificacion)
    especMap.set(e.tecnico_id, existing)
  }

  const tecnicos: TecnicoCache[] = tecnicosRaw.map((t) => ({
    nombre_completo: t.nombre_completo,
    area: t.area,
    especializaciones: especMap.get(t.id) ?? [],
  }))

  catalogCache = { clasificaciones, tecnicos, timestamp: now }
  return catalogCache
}

// ── Dynamic System Prompt Builder ────────────────────────────────────────────

function buildSystemPrompt(catalog: CatalogCache, userName: string): string {
  // Group classifications by area
  const byArea = new Map<string, ClasificacionCache[]>()
  for (const c of catalog.clasificaciones) {
    const existing = byArea.get(c.area) ?? []
    existing.push(c)
    byArea.set(c.area, existing)
  }

  // Build classifications section
  let clasificacionesSection = ''
  for (const [area, items] of byArea) {
    const claves = items.map((i) => i.clave).join(', ')
    clasificacionesSection += `   - **${area}**: ${claves}\n`

    // Add context for each classification that has it
    const conContexto = items.filter((i) => i.contexto_chatbot)
    if (conContexto.length > 0) {
      clasificacionesSection += `     Glosario:\n`
      for (const item of conContexto) {
        clasificacionesSection += `     • ${item.clave} (${item.nombre}): ${item.contexto_chatbot}\n`
      }
    }
  }

  // Build technicians section (so the AI knows who handles what)
  let tecnicosSection = ''
  const tecnicosByArea = new Map<string, TecnicoCache[]>()
  for (const t of catalog.tecnicos) {
    const existing = tecnicosByArea.get(t.area) ?? []
    existing.push(t)
    tecnicosByArea.set(t.area, existing)
  }

  for (const [area, techs] of tecnicosByArea) {
    tecnicosSection += `   - **${area}**:\n`
    for (const t of techs) {
      const esps = t.especializaciones.length > 0
        ? ` (especializado en: ${t.especializaciones.join(', ')})`
        : ' (sin especialización definida — atiende cualquier clasificación)'
      tecnicosSection += `     • ${t.nombre_completo}${esps}\n`
    }
  }

  // Build valid classifications list for the JSON format instruction
  const validList = [...byArea.entries()]
    .map(([area, items]) => `${area}: ${items.map((i) => i.clave).join(', ')}`)
    .join(' | ')

  return `Eres un asistente de soporte técnico y de infraestructura amigable y profesional para la empresa LIEC. Responde siempre en español.

Tu objetivo es ayudar a los empleados a crear tickets de soporte. Sigue este flujo:

1. **Saludo y recopilación**: Saluda al usuario y pídele que describa su problema o necesidad con el mayor detalle posible.

2. **Clasificación automática**: Analiza la descripción y determina:
   - **Área** (area): TIC o INFRAESTRUCTURA
   - **Clasificación** (clasificacion): una de las opciones válidas para el área detectada
   - **Prioridad** (prioridad): BAJA, MEDIA o ALTA según la urgencia

3. **Áreas y clasificaciones válidas (CATÁLOGO OFICIAL — usa SOLO estas)**:
${clasificacionesSection}
4. **Técnicos disponibles y sus especializaciones**:
${tecnicosSection}
   NOTA: La asignación al técnico es automática — NO le digas al usuario a quién se asignará. Solo usa esta información para entender el contexto y validar que la clasificación tiene sentido.

5. **Criterios de prioridad**:
   - **ALTA**: Afecta a múltiples usuarios, detiene operaciones críticas, riesgo de seguridad, fuga de agua/gas, falla eléctrica peligrosa
   - **MEDIA**: Afecta el trabajo de un usuario o equipo, degradación de servicio, problema recurrente
   - **BAJA**: Solicitud de mejora, problema menor que tiene solución temporal, mantenimiento preventivo

6. **Presentar resumen**: Muestra al usuario un resumen estructurado con los datos del ticket y explica brevemente por qué elegiste esa clasificación y prioridad. Pregunta si los datos son correctos y pide confirmación explícita.

7. **Confirmación**: SOLO cuando el usuario confirme explícitamente (por ejemplo: "sí", "confirmo", "correcto", "de acuerdo", "adelante"), genera el bloque JSON con ticket_data y confirmado: true.

8. **Formato de salida con confirmación**: Cuando el usuario confirme, incluye en tu respuesta un bloque JSON con exactamente esta estructura:
\`\`\`json
{
  "ticket_data": {
    "descripcion": "Descripción detallada del problema (mínimo 10 caracteres)",
    "area": "TIC o INFRAESTRUCTURA",
    "clasificacion": "Clasificación válida del catálogo oficial (${validList})",
    "prioridad": "BAJA, MEDIA o ALTA",
    "confirmado": true
  }
}
\`\`\`

9. **Casos especiales**:
   - Si la descripción es ambigua o muy corta, haz preguntas de aclaración antes de clasificar.
   - Si el usuario habla de temas no relacionados con soporte técnico o infraestructura, redirige amablemente la conversación.
   - Si el usuario quiere corregir algún dato (área, clasificación o prioridad), acepta la corrección y presenta un nuevo resumen.
   - Si el usuario no confirma o dice que algo está mal, pregunta qué desea cambiar.

10. **Imágenes**: Recuerda al usuario que puede adjuntar imágenes o fotos para ilustrar mejor el problema. Esto ayuda a los técnicos a entender la situación más rápidamente.

11. **Reglas anti-alucinación (CRÍTICAS)**:
    - NUNCA generes el bloque JSON de ticket_data sin confirmación explícita del usuario.
    - NUNCA uses clasificaciones que no estén en el catálogo oficial listado arriba.
    - NUNCA inventes o asumas detalles que el usuario no haya mencionado en la descripción.
    - La "descripcion" del ticket DEBE ser un resumen fiel de lo que el usuario dijo, sin agregar información que no proporcionó.
    - Si no estás seguro del área o clasificación, PREGUNTA al usuario en vez de adivinar.
    - NO des soluciones técnicas ni diagnósticos. Tu rol es SOLO recopilar información y crear el ticket.
    - NO menciones nombres de técnicos ni a quién se asignará el ticket.
    - Después de crear un ticket, ofrece ayuda para crear otro si lo necesita.
    - Sé conciso pero amable en tus respuestas.

El usuario se llama ${userName}.`
}

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

/** Extract and validate ticket_data from the AI response text. */
function extractTicketData(
  text: string,
  validClasificaciones: Map<string, string[]>,
): TicketDataResponse | undefined {
  // Try ```json block first
  const jsonBlockMatch = text.match(/```json\s*([\s\S]*?)```/)
  if (jsonBlockMatch) {
    const parsed = tryParseTicketData(jsonBlockMatch[1].trim(), validClasificaciones)
    if (parsed) return parsed
  }

  // Try inline JSON
  const inlineMatch = text.match(/\{[\s\S]*\}/)
  if (inlineMatch) {
    const parsed = tryParseTicketData(inlineMatch[0], validClasificaciones)
    if (parsed) return parsed
  }

  return undefined
}

function tryParseTicketData(
  jsonStr: string,
  validClasificaciones: Map<string, string[]>,
): TicketDataResponse | undefined {
  try {
    const data = JSON.parse(jsonStr)
    // Handle both { ticket_data: {...} } and direct {...} formats
    const td = data.ticket_data ?? data

    const validAreas = ['TIC', 'INFRAESTRUCTURA']
    const validPrioridades = ['BAJA', 'MEDIA', 'ALTA']

    if (
      typeof td.descripcion === 'string' &&
      td.descripcion.length >= 10 &&
      validAreas.includes(td.area) &&
      validClasificaciones.get(td.area)?.includes(td.clasificacion) &&
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
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

    if (!supabaseUrl || !anonKey) {
      console.error('[chat-tickets] Missing SUPABASE_URL or ANON_KEY')
      return jsonResponse({ error: 'Error interno del servidor.' }, 500)
    }

    // Client with user JWT for auth validation
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

    // ── 4. Load catalog (classifications + technicians) from DB ─────────────

    // Service role client to bypass RLS (read-only catalog data)
    const supabaseService = createClient(supabaseUrl, serviceRoleKey || anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })

    const catalog = await loadCatalog(supabaseService)

    // Build valid classifications map for validation
    const validClasificaciones = new Map<string, string[]>()
    for (const c of catalog.clasificaciones) {
      const existing = validClasificaciones.get(c.area) ?? []
      existing.push(c.clave)
      validClasificaciones.set(c.area, existing)
    }

    // ── 5. Get OpenAI API key ──────────────────────────────────────────────

    const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
    if (!openaiApiKey) {
      console.error('[chat-tickets] OPENAI_API_KEY not configured')
      return jsonResponse({ error: 'Error interno del servidor.' }, 500)
    }

    // ── 6. Prepare messages for OpenAI ─────────────────────────────────────

    // Truncate to last 20 messages
    const recentMessages = messages.slice(-20)

    const systemPrompt = buildSystemPrompt(catalog, user_name)

    const openaiMessages = [
      {
        role: 'system' as const,
        content: systemPrompt,
      },
      ...recentMessages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    ]

    // ── 7. Call OpenAI API with 30s timeout ────────────────────────────────

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
            temperature: 0.4,
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

    // ── 8. Parse OpenAI response ───────────────────────────────────────────

    const openaiData = await openaiResponse.json()
    const choice = openaiData.choices?.[0]
    const assistantMessage: string =
      choice?.message?.content ?? 'Lo siento, no pude generar una respuesta.'

    // ── 9. Log metadata (no conversation content) ──────────────────────────

    const usage = openaiData.usage
    console.log(
      `[chat-tickets] user=${user_id} ts=${new Date().toISOString()} prompt_tokens=${usage?.prompt_tokens ?? '?'} completion_tokens=${usage?.completion_tokens ?? '?'} total_tokens=${usage?.total_tokens ?? '?'}`,
    )

    // ── 10. Extract ticket_data if present (validated against DB catalog) ───

    const ticketData = extractTicketData(assistantMessage, validClasificaciones)

    // ── 11. Build and return response ──────────────────────────────────────

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
