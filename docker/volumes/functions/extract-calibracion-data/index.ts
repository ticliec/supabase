// Edge Function: extrae datos estructurados de un PDF de calibración usando OpenAI Assistants API.
// Sube el PDF directamente a OpenAI y usa file_search para leerlo.
//
// Recibe: { storage_path: string, campos: string[] }
// Retorna: { campos: [{ campo, valor }], confianza: number }

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-requested-with',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const BUCKET = 'erp-doc-staging'
const OPENAI_BASE = 'https://api.openai.com/v1'
const POLL_INTERVAL_MS = 2_000
const MAX_POLL_MS = 55_000

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

async function openaiRequest(
  path: string,
  apiKey: string,
  options: RequestInit = {},
): Promise<Response> {
  return fetch(`${OPENAI_BASE}${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'OpenAI-Beta': 'assistants=v2',
      ...(options.headers ?? {}),
    },
  })
}

async function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405)
  }

  // --- Environment variables ---
  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY')

  if (!supabaseUrl || !serviceRoleKey) {
    return jsonResponse({ error: 'Server misconfigured: missing Supabase credentials' }, 500)
  }
  if (!openaiApiKey) {
    return jsonResponse({ error: 'Server misconfigured: missing OPENAI_API_KEY' }, 500)
  }

  // --- Auth check ---
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!supabaseAnonKey) {
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  // --- Parse request body ---
  let body: { storage_path?: string; campos?: string[] }
  try {
    body = await req.json()
  } catch {
    return jsonResponse({ error: 'Invalid JSON body' }, 400)
  }

  const { storage_path, campos } = body

  if (!storage_path || typeof storage_path !== 'string' || storage_path.trim().length === 0) {
    return jsonResponse({ error: 'storage_path is required' }, 400)
  }
  if (!campos || !Array.isArray(campos) || campos.length === 0) {
    return jsonResponse({ error: 'campos is required and must be a non-empty array' }, 400)
  }

  const camposValidos = campos
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && c.length <= 100)

  if (camposValidos.length === 0 || camposValidos.length > 20) {
    return jsonResponse({ error: 'campos must contain 1-20 valid field names' }, 400)
  }

  // --- Download PDF from Supabase Storage ---
  const admin = createClient(supabaseUrl, serviceRoleKey)
  const { data: fileData, error: downloadErr } = await admin.storage
    .from(BUCKET)
    .download(storage_path.trim())

  if (downloadErr || !fileData) {
    console.error('Storage download error:', downloadErr)
    return jsonResponse({ error: 'Failed to download PDF from storage' }, 404)
  }

  const pdfBytes = await fileData.arrayBuffer()

  // --- Upload PDF to OpenAI Files API ---
  let openaiFileId: string
  try {
    const formData = new FormData()
    formData.append('file', new Blob([pdfBytes], { type: 'application/pdf' }), 'calibracion.pdf')
    formData.append('purpose', 'assistants')

    const uploadRes = await fetch(`${OPENAI_BASE}/files`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiApiKey}` },
      body: formData,
    })

    if (!uploadRes.ok) {
      const errText = await uploadRes.text()
      console.error('OpenAI file upload failed:', errText)
      return jsonResponse({ error: 'Failed to upload PDF to AI service' }, 502)
    }

    const uploadData = await uploadRes.json()
    openaiFileId = uploadData.id
  } catch (err: unknown) {
    console.error('File upload error:', err)
    return jsonResponse({ error: 'Failed to upload PDF to AI service' }, 502)
  }

  // --- Create Assistant (or reuse) ---
  const assistantInstructions = `Eres un asistente especializado en extraer datos de certificados de calibración.
Analiza el documento PDF adjunto y extrae los campos solicitados.

REGLAS:
- Extrae SOLO los campos solicitados.
- Si no encuentras un campo, devuelve su valor como "".
- Para fechas, usa formato YYYY-MM-DD.
- Para "caducidad en meses", calcula la diferencia entre vencimiento y calibración si están disponibles.
- Responde ÚNICAMENTE con JSON válido:
  { "campos": [{ "campo": "<nombre>", "valor": "<valor>" }], "confianza": <0.0-1.0> }
- NO incluyas explicaciones ni markdown, solo el JSON puro.`

  let assistantId: string
  try {
    const createRes = await openaiRequest('/assistants', openaiApiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-4o',
        name: 'Calibracion PDF Extractor',
        instructions: assistantInstructions,
        tools: [{ type: 'file_search' }],
      }),
    })

    if (!createRes.ok) {
      const errText = await createRes.text()
      console.error('Assistant creation failed:', errText)
      return jsonResponse({ error: 'Failed to create AI assistant' }, 502)
    }

    const assistantData = await createRes.json()
    assistantId = assistantData.id
  } catch (err: unknown) {
    console.error('Assistant error:', err)
    return jsonResponse({ error: 'AI service error' }, 502)
  }

  // --- Create Thread with the PDF attached ---
  let threadId: string
  try {
    const userMessage = `Extrae los siguientes campos del certificado de calibración adjunto:

${camposValidos.map((c, i) => `${i + 1}. ${c}`).join('\n')}

Responde SOLO con el JSON estructurado, sin markdown ni explicaciones.`

    const threadRes = await openaiRequest('/threads', openaiApiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: userMessage,
            attachments: [
              { file_id: openaiFileId, tools: [{ type: 'file_search' }] },
            ],
          },
        ],
      }),
    })

    if (!threadRes.ok) {
      const errText = await threadRes.text()
      console.error('Thread creation failed:', errText)
      return jsonResponse({ error: 'Failed to create AI thread' }, 502)
    }

    const threadData = await threadRes.json()
    threadId = threadData.id
  } catch (err: unknown) {
    console.error('Thread error:', err)
    return jsonResponse({ error: 'AI service error' }, 502)
  }

  // --- Run the Assistant ---
  let runId: string
  try {
    const runRes = await openaiRequest(`/threads/${threadId}/runs`, openaiApiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assistant_id: assistantId }),
    })

    if (!runRes.ok) {
      const errText = await runRes.text()
      console.error('Run creation failed:', errText)
      return jsonResponse({ error: 'Failed to start AI analysis' }, 502)
    }

    const runData = await runRes.json()
    runId = runData.id
  } catch (err: unknown) {
    console.error('Run error:', err)
    return jsonResponse({ error: 'AI service error' }, 502)
  }

  // --- Poll for completion ---
  const startTime = Date.now()
  let runStatus = 'queued'

  while (runStatus !== 'completed' && runStatus !== 'failed' && runStatus !== 'cancelled') {
    if (Date.now() - startTime > MAX_POLL_MS) {
      // Cleanup
      await openaiRequest(`/threads/${threadId}/runs/${runId}/cancel`, openaiApiKey, { method: 'POST' })
      await openaiRequest(`/assistants/${assistantId}`, openaiApiKey, { method: 'DELETE' })
      await openaiRequest(`/files/${openaiFileId}`, openaiApiKey, { method: 'DELETE' })
      return jsonResponse({ error: 'Tiempo de espera agotado (55s). Intente con un PDF más pequeño.' }, 504)
    }

    await delay(POLL_INTERVAL_MS)

    const statusRes = await openaiRequest(`/threads/${threadId}/runs/${runId}`, openaiApiKey)
    if (!statusRes.ok) break
    const statusData = await statusRes.json()
    runStatus = statusData.status
  }

  if (runStatus !== 'completed') {
    await openaiRequest(`/assistants/${assistantId}`, openaiApiKey, { method: 'DELETE' })
    await openaiRequest(`/files/${openaiFileId}`, openaiApiKey, { method: 'DELETE' })
    return jsonResponse({ error: 'AI analysis failed. Please retry.' }, 502)
  }

  // --- Get messages (response) ---
  let responseText = ''
  try {
    const msgsRes = await openaiRequest(`/threads/${threadId}/messages?order=desc&limit=1`, openaiApiKey)
    if (msgsRes.ok) {
      const msgsData = await msgsRes.json()
      const lastMsg = msgsData.data?.[0]
      if (lastMsg?.role === 'assistant' && lastMsg.content) {
        for (const block of lastMsg.content) {
          if (block.type === 'text') {
            responseText += block.text.value
          }
        }
      }
    }
  } catch (err: unknown) {
    console.error('Messages fetch error:', err)
  }

  // --- Cleanup OpenAI resources ---
  await openaiRequest(`/assistants/${assistantId}`, openaiApiKey, { method: 'DELETE' }).catch(() => {})
  await openaiRequest(`/files/${openaiFileId}`, openaiApiKey, { method: 'DELETE' }).catch(() => {})

  // --- Parse response ---
  if (!responseText || responseText.trim().length === 0) {
    return jsonResponse(
      { error: 'No se pudieron extraer datos del PDF. Verifique que el contenido sea legible.' },
      422,
    )
  }

  // Clean markdown code blocks if present
  let cleanJson = responseText.trim()
  if (cleanJson.startsWith('```')) {
    cleanJson = cleanJson.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
  }

  let parsed: { campos?: Array<{ campo: string; valor: string }>; confianza?: number }
  try {
    parsed = JSON.parse(cleanJson)
  } catch {
    console.error('Failed to parse AI response:', responseText)
    return jsonResponse({ error: 'Failed to parse AI response. Please retry.' }, 422)
  }

  // Validate and normalize
  const extractedCampos = Array.isArray(parsed.campos)
    ? parsed.campos
        .filter(
          (item): item is { campo: string; valor: string } =>
            item != null &&
            typeof item === 'object' &&
            typeof item.campo === 'string',
        )
        .map((item) => ({
          campo: item.campo,
          valor: typeof item.valor === 'string' ? item.valor : '',
        }))
    : []

  const confianza = typeof parsed.confianza === 'number'
    ? Math.max(0, Math.min(1, parsed.confianza))
    : 0

  if (extractedCampos.length === 0) {
    return jsonResponse(
      { error: 'No se pudieron extraer datos del PDF.' },
      422,
    )
  }

  return jsonResponse({
    campos: extractedCampos,
    confianza: Math.round(confianza * 100) / 100,
  })
})
