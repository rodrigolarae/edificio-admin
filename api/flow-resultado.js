// ══════════════════════════════════════════════════════════════
// Vecinoo — Edge Function: /api/flow-resultado
// Flow redirige al usuario aquí después del pago.
// Muestra resultado y redirige de vuelta a la app.
// ══════════════════════════════════════════════════════════════
import { createHmac } from 'crypto'
import { supabaseAdmin } from './_lib/supabase.js'

const FLOW_API_URL = process.env.FLOW_API_URL || 'https://www.flow.cl/api'

export default async function handler(req, res) {
  const { token, orden } = req.query
  const comunidadId = req.query.comunidad_id

  if (!token || !comunidadId) {
    return res.redirect('/?pago=error')
  }

  try {
    const { data: flowConfig } = await supabaseAdmin
      .from('comunidades_flow_config')
      .select('api_key, secret_key')
      .eq('comunidad_id', comunidadId)
      .maybeSingle()

    if (!flowConfig) {
      return res.redirect('/?pago=error')
    }

    const sig = createHmac('sha256', flowConfig.secret_key)
      .update(`apiKey${flowConfig.api_key}token${token}`)
      .digest('hex')

    const flowRes = await fetch(`${FLOW_API_URL}/payment/getStatus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ apiKey: flowConfig.api_key, token, s: sig }),
    })

    const data = await flowRes.json()
    // status 2 = pagado
    if (data.status === 2) {
      return res.redirect(`/?pago=exitoso&orden=${orden || ''}`)
    } else {
      return res.redirect(`/?pago=fallido&orden=${orden || ''}`)
    }
  } catch (e) {
    console.error(e)
    return res.redirect('/?pago=error')
  }
}
