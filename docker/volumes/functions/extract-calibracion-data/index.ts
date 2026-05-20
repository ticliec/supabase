// Edge Function: extrae datos de un PDF de calibración usando OpenAI Responses API.
// Usa el input type "file" que soporta PDFs nativamente con GPT-4o.
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

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
  const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY')

  if (!supabaseUrl || !serviceRoleKey || !openaiApiKey || !supabaseAnonKey) {
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  // Auth check
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user }, error: userErr } = await userClient.auth.getUser()
  if (userErr || !user) return jsonResponse({ error: 'Unauthorized' }, 401)

  // Parse body
  let body: { storage_path?: string; campos?: string[] }
  try { body = await req.json() } catch { return jsonResponse({ error: 'Invalid JSON' }, 400) }

  const { storage_path, campos } = body
  if (!storage_path || typeof storage_path !== 'string') {
    return jsonResponse({ error: 'storage_path required' }, 400)
  }
  if (!campos || !Array.isArray(campos) || campos.length === 0) {
    return jsonResponse({ error: 'campos required' }, 400)
  }

  const camposValidos = campos
    .filter((c): c is string => typeof c === 'string')
    .map((c) => c.trim())
    .filter((c) => c.length > 0 && c.length <= 100)
    .slice(0, 20)

  if (camposValidos.length === 0) {
    return jsonResponse({ error: 'At least 1 valid campo required' }, 400)
  }

  // Download PDF from Storage
  const admin = createClient(supabaseUrl, serviceRoleKey)
  const { data: fileData, error: dlErr } = await admin.storage
    .from(BUCKET)
    .download(storage_path.trim())

  if (dlErr || !fileData) {
    return jsonResponse({ error: 'Failed to download PDF' }, 404)
  }

  // Convert to base64
  const arrayBuffer = await fileData.arrayBuffer()
  const bytes = new Uint8Array(arrayBuffer)
  let base64 = ''
  const chunkSize = 8192
  for (let i = 0; i < bytes.length; i += chunkSize) {
    base64 += String.fromCharCode(...bytes.slice(i, i + chunkSize))
  }
  base64 = btoa(base64)

  // Build prompt
  const prompt = `Analiza este documento PDF de calibración y extrae los siguientes campos.
Si no encuentras un campo, devuelve su valor como cadena vacía "".
Para fechas usa formato YYYY-MM-DD.
Para "caducidad en meses" calcula la diferencia entre fecha de vencimiento y fecha de calibración.

Campos a extraer:
${camposValidos.map((c, i) => `${i + 1}. ${c}`).join('\n')}

RESPONDE ÚNICAMENTE con este JSON (sin markdown, sin explicaciones):
{ "campos": [{ "campo": "nombre_campo", "valor": "valor_extraido" }], "confianza": 0.85 }`

  // Call OpenAI Chat Completions with file input (GPT-4o supports PDF via base64)
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${openaiApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'file',
                file: {
                  filename: 'calibracion.pdf',
                  file_data: `data:application/pdf;base64,${base64}`,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 2000,
      }),
    })

    if (!response.ok) {
      const errBody = await response.text()
      console.error('OpenAI error:', response.status, errBody)
      return jsonResponse({ error: `AI service error (${response.status})` }, 502)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content ?? ''

    if (!content.trim()) {
      return jsonResponse({ error: 'No se pudieron extraer datos del PDF.' }, 422)
    }

    // Clean markdown if present
    let cleanJson = content.trim()
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '')
    }

    const parsed = JSON.parse(cleanJson)
    const extractedCampos = Array.isArray(parsed.campos)
      ? parsed.campos
          .filter((item: any) => item && typeof item.campo === 'string')
          .map((item: any) => ({ campo: item.campo, valor: String(item.valor ?? '') }))
      : []

    const confianza = typeof parsed.confianza === 'number'
      ? Math.max(0, Math.min(1, parsed.confianza))
      : 0

    if (extractedCampos.length === 0) {
      return jsonResponse({ error: 'No se pudieron extraer datos del PDF.' }, 422)
    }

    return jsonResponse({ campos: extractedCampos, confianza: Math.round(confianza * 100) / 100 })
  } catch (err: unknown) {
    console.error('Extraction error:', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    return jsonResponse({ error: `Error en extracción: ${msg}` }, 502)
  }
})
