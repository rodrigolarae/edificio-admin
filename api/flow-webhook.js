// ══════════════════════════════════════════════════════════════
// Vecinoo — Edge Function: /api/flow-webhook
// Recibe la confirmación de pago de Flow.cl.
// Cada comunidad tiene su propia cuenta/credenciales de Flow, así que este
// webhook recibe el comunidad_id en la URL (lo agregamos nosotros al crear
// la orden) para saber con qué secretKey verificar la firma.
// ══════════════════════════════════════════════════════════════

import { createHmac } from 'crypto'
import { supabaseAdmin } from './_lib/supabase.js'

const FLOW_API_URL = process.env.FLOW_API_URL || 'https://www.flow.cl/api'
const RESEND_KEY = process.env.RESEND_KEY

function verificarFirma(params, secret) {
  const { s, ...rest } = params
  const keys = Object.keys(rest).sort()
  const toSign = keys.map(k => `${k}${rest[k]}`).join('')
  const esperado = createHmac('sha256', secret).update(toSign).digest('hex')
  return s === esperado
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  try {
    const params = req.body
    const comunidadId = req.query.comunidad_id

    if (!comunidadId) {
      console.error('Webhook Flow sin comunidad_id en la URL')
      return res.status(400).json({ error: 'Falta comunidad_id' })
    }

    // Buscar las credenciales de Flow de ESTA comunidad
    const { data: flowConfig } = await supabaseAdmin
      .from('comunidades_flow_config')
      .select('api_key, secret_key')
      .eq('comunidad_id', comunidadId)
      .maybeSingle()

    if (!flowConfig) {
      console.error('No hay configuración de Flow para la comunidad', comunidadId)
      return res.status(400).json({ error: 'Comunidad sin configuración de Flow' })
    }

    if (!verificarFirma(params, flowConfig.secret_key)) {
      console.error('Firma inválida — posible fraude. Comunidad:', comunidadId)
      return res.status(401).json({ error: 'Firma inválida' })
    }

    const { token, commerceOrder, status } = params
    // status: 1=pendiente, 2=pagado, 3=rechazado, 4=anulado
    if (status !== '2') {
      console.log(`Pago no confirmado. Status: ${status}, Orden: ${commerceOrder}`)
      return res.status(200).json({ ok: true, msg: 'Pago no exitoso' })
    }

    // Confirmar el estado directo con Flow (nunca confiar solo en el body recibido)
    const sigStatus = createHmac('sha256', flowConfig.secret_key)
      .update(`apiKey${flowConfig.api_key}token${token}`)
      .digest('hex')

    const flowRes = await fetch(`${FLOW_API_URL}/payment/getStatus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ apiKey: flowConfig.api_key, token, s: sigStatus }),
    })
    const flowData = await flowRes.json()

    // Actualizar pagos_flow
    await supabaseAdmin.from('pagos_flow')
      .update({
        status: 'pagado',
        flow_token: token,
        flow_order: flowData.flowOrder,
        fecha_pago: new Date().toISOString(),
        monto_cobrado: flowData.amount,
      })
      .eq('orden_id', commerceOrder)
      .eq('comunidad_id', comunidadId)

    const { data: ordenData } = await supabaseAdmin.from('pagos_flow')
      .select('*')
      .eq('orden_id', commerceOrder)
      .eq('comunidad_id', comunidadId)
      .single()

    if (ordenData) {
      await supabaseAdmin.from('pagos').insert({
        comunidad_id: ordenData.comunidad_id,
        unidad_id: ordenData.unidad_id,
        usuario_id: ordenData.usuario_id,
        month: ordenData.mes,
        amount: ordenData.monto_base || ordenData.amount,
        method: 'flow',
        date: new Date().toISOString().split('T')[0],
        flow_token: token,
        created_at: new Date().toISOString(),
      })

      await supabaseAdmin.from('audit_logs').insert({
        comunidad_id: ordenData.comunidad_id,
        accion: 'PAGO_FLOW_CONFIRMADO',
        detalle: `Pago Flow confirmado · Orden ${commerceOrder} · $${ordenData.monto_total || ordenData.amount}`,
      })

      if (RESEND_KEY && ordenData.email_residente) {
        await fetch('https://api.resend.com/emails', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${RESEND_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            from: 'pagos@vecinoo.cl',
            to: ordenData.email_residente,
            subject: `✅ Comprobante de pago GC ${ordenData.mes || ''} — Vecinoo`,
            html: `
              <div style="font-family:Arial;max-width:500px;margin:0 auto;padding:30px">
                <h2 style="color:#0F172A">✅ Pago confirmado</h2>
                <p>Tu pago de gastos comunes fue procesado exitosamente.</p>
                <table style="width:100%;border-collapse:collapse;margin:20px 0">
                  <tr style="border-bottom:1px solid #eee">
                    <td style="padding:8px 0;color:#6b7280">Período</td>
                    <td style="padding:8px 0;font-weight:bold">${ordenData.mes || ''}</td>
                  </tr>
                  <tr style="border-bottom:1px solid #eee">
                    <td style="padding:8px 0;color:#6b7280">Monto GC</td>
                    <td style="padding:8px 0;font-weight:bold">$${(ordenData.monto_base || ordenData.amount || 0).toLocaleString('es-CL')}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;font-weight:bold">Total pagado</td>
                    <td style="padding:8px 0;font-weight:bold;color:#2E766B">$${(ordenData.monto_total || ordenData.amount || 0).toLocaleString('es-CL')}</td>
                  </tr>
                </table>
                <p style="font-size:12px;color:#9ca3af">N° Orden: ${commerceOrder}<br>Procesado por Flow.cl · Vecinoo.cl</p>
              </div>
            `,
          }),
        }).catch(e => console.error('Error email:', e))
      }
    }

    return res.status(200).json({ ok: true })
  } catch (err) {
    console.error('Error webhook:', err)
    return res.status(500).json({ error: err.message })
  }
}
