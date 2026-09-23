// api/crear-orden.js — antes flow-crear-orden.js
// Crea una orden de pago en Flow, usando las credenciales de Flow propias
// de CADA comunidad (nunca una cuenta global compartida), para que el dinero
// de cada comunidad llegue directo a su propia cuenta bancaria vía Flow.
import { createHmac } from 'crypto'
import { withAuth, supabaseAdmin } from './_lib/supabase.js'

const FLOW_API_URL = process.env.FLOW_API_URL || 'https://www.flow.cl/api'

// Firma oficial de Flow: HMAC-SHA256 de los parámetros ordenados alfabéticamente
// y concatenados como "nombreValor" (sin separadores), usando el secretKey como
// llave del HMAC. Ver https://developers.flow.cl/docs/intro
function signParams(params, secretKey) {
  const keys = Object.keys(params).sort()
  const toSign = keys.map(k => `${k}${params[k]}`).join('')
  return createHmac('sha256', secretKey).update(toSign).digest('hex')
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' })
    return
  }

  try {
    const { amount, email, orderId, concepto, unidadId } = req.body
    const user = req.user

    if (!amount || amount < 1000) {
      res.status(400).json({ error: 'Monto inválido' })
      return
    }
    if (user.unidad_id && user.unidad_id !== unidadId) {
      res.status(403).json({ error: 'Unidad no corresponde al usuario' })
      return
    }
    if (!user.comunidad_id) {
      res.status(400).json({ error: 'Tu cuenta no está asociada a una comunidad' })
      return
    }

    // Buscar las credenciales de Flow propias de ESTA comunidad (nunca globales)
    const { data: flowConfig, error: cfgErr } = await supabaseAdmin
      .from('comunidades_flow_config')
      .select('api_key, secret_key, activo')
      .eq('comunidad_id', user.comunidad_id)
      .maybeSingle()

    if (cfgErr || !flowConfig || !flowConfig.activo) {
      res.status(400).json({ error: 'Esta comunidad todavía no tiene configurado el cobro con Flow. Contacta al administrador.' })
      return
    }

    const baseUrl = process.env.SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : req.headers.origin)
    const commerceOrder = orderId || `VEC-${user.comunidad_id.slice(0, 8)}-${Date.now()}`

    const params = {
      apiKey: flowConfig.api_key,
      commerceOrder,
      subject: concepto || `Gasto común`,
      currency: 'CLP',
      amount: Math.round(amount),
      email: email || user.email,
      urlReturn: `${baseUrl}/api/flow-resultado?comunidad_id=${user.comunidad_id}`,
      urlConfirmation: `${baseUrl}/api/flow-webhook?comunidad_id=${user.comunidad_id}`,
    }
    params.s = signParams(params, flowConfig.secret_key)

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

    await supabaseAdmin.from('pagos_flow').insert({
      usuario_id: user.id,
      comunidad_id: user.comunidad_id,
      unidad_id: unidadId,
      orden_id: commerceOrder,
      flow_token: flowData.token,
      monto_base: params.amount,
      monto_total: params.amount,
      email_residente: params.email,
      status: 'pendiente',
      created_at: new Date().toISOString()
    })

    res.status(200).json({ url: flowData.url, token: flowData.token, order: commerceOrder })
  } catch (err) {
    console.error('Error flow-crear-orden:', err)
    res.status(500).json({ error: 'Error interno' })
  }
}

export default withAuth(handler, ['residente', 'admin', 'presidente', 'tesorero'])
