// api/flow-crear-orden-seguro.js
import { createHash } from 'crypto'
import { withAuth, supabaseAdmin } from './_lib/supabase.js'

// Variables de entorno (las configuras en Vercel, NUNCA en GitHub)
const FLOW_API_KEY = process.env.FLOW_API_KEY
const FLOW_SECRET_KEY = process.env.FLOW_SECRET_KEY
const FLOW_API_URL = process.env.FLOW_API_URL || 'https://sandbox.flow.cl/api'

function signParams(params, secret) {
  const sorted = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&')
  return createHash('sha256').update(sorted + secret).digest('hex')
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' })
    return
  }

  try {
    const { amount, email, orderId, concepto, unidadId } = req.body
    const user = req.user

    // Validaciones de negocio
    if (!amount || amount < 1000) {
      res.status(400).json({ error: 'Monto inválido' })
      return
    }

    // Verificar que el usuario pertenece a la unidad (anti-tampering)
    if (user.unidad_id && user.unidad_id !== unidadId) {
      res.status(403).json({ error: 'Unidad no corresponde al usuario' })
      return
    }

    const params = {
      apiKey: FLOW_API_KEY,
      commerceOrder: orderId || `VEC-${Date.now()}`,
      subject: concepto || `GC ${user.comunidad_id}`,
      currency: 'CLP',
      amount: Math.round(amount),
      email: email || user.email,
      urlReturn: `${process.env.VERCEL_URL || req.headers.origin}/pago-resultado`,
      urlConfirmation: `${process.env.VERCEL_URL || req.headers.origin}/api/flow-webhook`,
    }

    params.s = signParams(params, FLOW_SECRET_KEY)

    const formData = new URLSearchParams()
    Object.entries(params).forEach(([k, v]) => formData.append(k, v))

    const flowRes = await fetch(`${FLOW_API_URL}/payment/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formData.toString()
    })

    const flowData = await flowRes.json()

    if (!flowRes.ok || flowData.code) {
      console.error('Flow error:', flowData)
      res.status(502).json({ error: 'Error al crear orden en Flow', detail: flowData.message })
      return
    }

    // Guardar referencia en BD (tabla pagos_flow)
    await supabaseAdmin.from('pagos_flow').insert({
      usuario_id: user.id,
      comunidad_id: user.comunidad_id,
      unidad_id: unidadId,
      flow_token: flowData.token,
      flow_url: flowData.url,
      amount: params.amount,
      status: 'pendiente',
      created_at: new Date().toISOString()
    })

    res.status(200).json({ url: flowData.url, token: flowData.token, order: params.commerceOrder })
  } catch (err) {
    console.error('Error flow-crear-orden:', err)
    res.status(500).json({ error: 'Error interno' })
  }
}

export default withAuth(handler, ['residente', 'admin', 'presidente', 'tesorero'])
