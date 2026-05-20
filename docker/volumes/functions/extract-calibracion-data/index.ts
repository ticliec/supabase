// Edge Function: extrae datos estructurados de un PDF de calibración usando OpenAI API.
//
// Recibe: { storage_path: string, campos: string[] }
// Retorna: { campos: [{ campo, valor }], confianza: number }
//
// Supabase Cloud: supabase functions deploy extract-calibracion-data

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.1'
import OpenAI from 'https://esm.sh/openai@4'

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-requested-with',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const BUCKET = 'erp-doc-staging'
const TIMEOUT_MS = 60_000

function jsonResponse(body: unknown, status = 200): Response {
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

  const {
    data: { user },
    error: userErr,
  } = await userClient.auth.getUser()

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
    return jsonResponse({ error: 'storage_path is required and must be a non-empty string' }, 400)
  }

  if (!campos || !Array.isArray(campos) || campos.length === 0) {
    return jsonResponse({ error: 'campos is required and must be a non-empty array of strings' }, 400)
  }

  // Validate each campo
  const camposValidos = campos
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && c.length <= 100)

  if (camposValidos.length === 0) {
    return jsonResponse({ error: 'campos must contain at least one valid field name (max 100 chars each)' }, 400)
  }

  if (camposValidos.length > 20) {
    return jsonResponse({ error: 'campos must not exceed 20 fields' }, 400)
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

  // Extract text from PDF using basic text extraction
  // PDF text streams are between BT...ET markers or in parentheses after Tj/TJ operators
  const arrayBuffer = await fileData.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  
  let pdfText: string
  try {
    // Decode the PDF bytes as latin1 to preserve all byte values
    const rawContent = new TextDecoder('latin1').decode(bytes)
    
    // Extract text from PDF streams - look for text between parentheses in text operators
    const textParts: string[] = []
    
    // Method 1: Extract from stream content (decompressed text)
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g
    let streamMatch: RegExpExecArray | null
    while ((streamMatch = streamRegex.exec(rawContent)) !== null) {
      const streamContent = streamMatch[1]
      // Look for text in Tj operators: (text) Tj
      const tjRegex = /\(([^)]*)\)\s*Tj/g
      let tjMatch: RegExpExecArray | null
      while ((tjMatch = tjRegex.exec(streamContent)) !== null) {
        if (tjMatch[1].trim()) textParts.push(tjMatch[1])
      }
      // Look for text in TJ arrays: [(text)] TJ
      const tjArrayRegex = /\[([^\]]*)\]\s*TJ/g
      let tjArrMatch: RegExpExecArray | null
      while ((tjArrMatch = tjArrayRegex.exec(streamContent)) !== null) {
        const innerRegex = /\(([^)]*)\)/g
        let innerMatch: RegExpExecArray | null
        while ((innerMatch = innerRegex.exec(tjArrMatch[1])) !== null) {
          if (innerMatch[1].trim()) textParts.push(innerMatch[1])
        }
      }
    }
    
    // Method 2: If no text found in streams, try to find readable ASCII sequences
    if (textParts.length === 0) {
      // Look for any readable text sequences (fallback)
      const readableRegex = /\(([A-Za-z0-9\s.,;:!?@#$%&*+=\-/\\'"áéíóúñÁÉÍÓÚÑ]{3,})\)/g
      let readableMatch: RegExpExecArray | null
      while ((readableMatch = readableRegex.exec(rawContent)) !== null) {
        textParts.push(readableMatch[1])
      }
    }
    
    pdfText = textParts.join(' ').replace(/\s+/g, ' ').trim()
  } catch (parseErr: unknown) {
    console.error('PDF parse error:', parseErr)
    return jsonResponse(
      { error: 'No se pudo leer el contenido del PDF. Verifique que el archivo no esté dañado o protegido.' },
      422,
    )
  }

  if (!pdfText || pdfText.trim().length < 10) {
    return jsonResponse(
      { error: 'El PDF no contiene texto legible. Puede ser un PDF escaneado (imagen). Intente con un PDF que tenga texto seleccionable.' },
      422,
    )
  }

  // Truncate to ~15000 chars to stay within token limits
  const truncatedText = pdfText.length > 15000 ? pdfText.substring(0, 15000) + '\n[...texto truncado...]' : pdfText

  // --- Call OpenAI API ---
  const openai = new OpenAI({ apiKey: openaiApiKey })

  const systemPrompt = `Eres un asistente especializado en extraer datos de certificados de calibración.
Se te proporcionará el texto extraído de un documento PDF y una lista de campos a extraer.
Debes analizar el contenido y extraer el valor de cada campo solicitado.

REGLAS:
- Extrae SOLO los campos solicitados.
- Si no encuentras un campo en el documento, devuelve su valor como cadena vacía "".
- Para fechas, usa formato YYYY-MM-DD (ejemplo: 2025-03-15).
- Para "caducidad en meses", calcula la diferencia entre fecha de vencimiento y fecha de calibración si están disponibles.
- Responde ÚNICAMENTE con un JSON válido con la siguiente estructura:
  { "campos": [{ "campo": "<nombre_campo>", "valor": "<valor_extraido>" }], "confianza": <0.0-1.0> }
- "confianza" es un número entre 0.0 y 1.0 que indica qué tan seguro estás de la extracción general.
- NO incluyas explicaciones, solo el JSON.`

  const userPrompt = `Extrae los siguientes campos del texto de este certificado de calibración:

Campos a extraer:
${camposValidos.map((c, i) => `${i + 1}. ${c}`).join('\n')}

--- TEXTO DEL DOCUMENTO ---
${truncatedText}
--- FIN DEL DOCUMENTO ---

Responde SOLO con el JSON estructurado.`

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), TIMEOUT_MS)

    const completion = await openai.chat.completions.create(
      {
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.1,
        max_tokens: 2000,
        response_format: { type: 'json_object' },
      },
      { signal: controller.signal },
    )

    clearTimeout(timeoutId)

    const responseContent = completion.choices?.[0]?.message?.content

    if (!responseContent || responseContent.trim().length === 0) {
      return jsonResponse(
        { error: 'OpenAI returned an empty response. The PDF may not contain readable text.' },
        422,
      )
    }

    // Parse the JSON response from OpenAI
    let parsed: { campos?: Array<{ campo: string; valor: string }>; confianza?: number }
    try {
      parsed = JSON.parse(responseContent)
    } catch {
      console.error('Failed to parse OpenAI response:', responseContent)
      return jsonResponse(
        { error: 'Failed to parse AI response. Please retry.' },
        422,
      )
    }

    // Validate and normalize the response
    const extractedCampos = Array.isArray(parsed.campos)
      ? parsed.campos
          .filter(
            (item): item is { campo: string; valor: string } =>
              item != null &&
              typeof item === 'object' &&
              typeof item.campo === 'string' &&
              (typeof item.valor === 'string' || item.valor == null),
          )
          .map((item) => ({
            campo: item.campo,
            valor: item.valor ?? '',
          }))
      : []

    const confianza = typeof parsed.confianza === 'number'
      ? Math.max(0, Math.min(1, parsed.confianza))
      : 0

    // Check if extraction returned anything useful
    if (extractedCampos.length === 0) {
      return jsonResponse(
        { error: 'No data could be extracted from the PDF. Verify the PDF content is readable.' },
        422,
      )
    }

    return jsonResponse({
      campos: extractedCampos,
      confianza: Math.round(confianza * 100) / 100,
    })
  } catch (err: unknown) {
    const error = err as { name?: string; status?: number; message?: string }

    // Handle timeout (AbortError)
    if (error.name === 'AbortError') {
      return jsonResponse(
        { error: 'Request timed out after 60 seconds. The PDF may be too large or complex.' },
        504,
      )
    }

    // Handle invalid API key
    if (error.status === 401) {
      console.error('OpenAI API key invalid')
      return jsonResponse(
        { error: 'AI service authentication failed. Contact administrator.' },
        502,
      )
    }

    // Handle rate limiting
    if (error.status === 429) {
      return jsonResponse(
        { error: 'AI service rate limit exceeded. Please retry in a few moments.' },
        429,
      )
    }

    // Generic OpenAI error
    console.error('OpenAI API error:', error.message ?? error)
    return jsonResponse(
      { error: 'AI extraction failed. Please retry.' },
      502,
    )
  }
})
