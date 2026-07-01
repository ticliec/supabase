// Edge Function: extrae datos de contacto de un PDF de cotización usando OpenAI GPT-4o.
// Lee SOLO la segunda página del PDF para extraer: empresa, obra, contacto, correo, teléfono.
//
// Recibe: multipart/form-data con campo "file" (PDF)
// Retorna: { empresa, tipo_empresa, obra, contacto_nombre, contacto_puesto, contacto_telefono, contacto_correo, confianza }

const corsHeaders: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-requested-with',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

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

  const openaiApiKey = Deno.env.get('OPENAI_API_KEY')
  if (!openaiApiKey) {
    return jsonResponse({ error: 'Server misconfigured' }, 500)
  }

  // Auth check (JWT en header)
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'Unauthorized' }, 401)
  }

  // Parse multipart form data
  let fileBytes: Uint8Array
  try {
    const formData = await req.formData()
    const file = formData.get('file') as File | null
    if (!file) {
      return jsonResponse({ error: 'Campo "file" requerido (PDF)' }, 400)
    }
    if (file.size > 10 * 1024 * 1024) {
      return jsonResponse({ error: 'El archivo excede 10MB' }, 400)
    }
    const buffer = await file.arrayBuffer()
    fileBytes = new Uint8Array(buffer)
  } catch {
    return jsonResponse({ error: 'Error al leer el archivo' }, 400)
  }

  // Convert to base64
  let base64 = ''
  const chunkSize = 8192
  for (let i = 0; i < fileBytes.length; i += chunkSize) {
    base64 += String.fromCharCode(...fileBytes.slice(i, i + chunkSize))
  }
  base64 = btoa(base64)

  // Build prompt - instruir a leer solo la segunda página
  const prompt = `Analiza este documento PDF. Es una cotización comercial de servicios de laboratorio.
ENFÓCATE ÚNICAMENTE EN LA SEGUNDA PÁGINA del documento para extraer los datos del cliente/empresa que solicita la cotización.

Extrae los siguientes datos:
1. empresa: Nombre de la empresa o razón social del CLIENTE (quien solicita la cotización, NO quien la emite)
2. tipo_empresa: Tipo de empresa (CONSTRUCTORA, GOBIERNO, INMOBILIARIA, u otro)
3. obra: Nombre del proyecto u obra relacionada (si se menciona)
4. contacto_nombre: Nombre completo de la persona de contacto del cliente
5. contacto_puesto: Puesto o cargo del contacto
6. contacto_telefono: Teléfono del contacto (solo dígitos si es posible)
7. contacto_correo: Correo electrónico del contacto

Si no encuentras un dato, devuelve cadena vacía "".
Si hay múltiples contactos, usa el que parezca principal (quien solicita la cotización).

RESPONDE ÚNICAMENTE con este JSON (sin markdown, sin explicaciones):
{
  "empresa": "",
  "tipo_empresa": "",
  "obra": "",
  "contacto_nombre": "",
  "contacto_puesto": "",
  "contacto_telefono": "",
  "contacto_correo": "",
  "confianza": 0.85
}`

  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 60_000)

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
                  filename: 'cotizacion.pdf',
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
        max_tokens: 1000,
      }),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      const errBody = await response.text()
      console.error('[extract-cotizacion-bnrc] OpenAI error:', response.status, errBody)
      return jsonResponse({ error: `Error del servicio de IA (${response.status})` }, 502)
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

    return jsonResponse({
      empresa: String(parsed.empresa ?? '').trim(),
      tipo_empresa: String(parsed.tipo_empresa ?? '').trim(),
      obra: String(parsed.obra ?? '').trim(),
      contacto_nombre: String(parsed.contacto_nombre ?? '').trim(),
      contacto_puesto: String(parsed.contacto_puesto ?? '').trim(),
      contacto_telefono: String(parsed.contacto_telefono ?? '').replace(/[^0-9]/g, ''),
      contacto_correo: String(parsed.contacto_correo ?? '').trim().toLowerCase(),
      confianza: typeof parsed.confianza === 'number' ? Math.round(parsed.confianza * 100) / 100 : 0,
    })
  } catch (err: unknown) {
    console.error('[extract-cotizacion-bnrc] Error:', err)
    const msg = err instanceof Error ? err.message : 'Unknown error'
    if (msg.includes('AbortError') || msg.includes('aborted')) {
      return jsonResponse({ error: 'Tiempo de espera agotado al procesar el PDF.' }, 504)
    }
    return jsonResponse({ error: `Error en extracción: ${msg}` }, 502)
  }
})
