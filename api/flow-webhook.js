// ══════════════════════════════════════════════════════════════
// Vecinoo — Edge Function: /api/flow-webhook
// Recibe la confirmación de pago de Flow.cl
// Flow llama a esta URL cuando el pago es confirmado
// ══════════════════════════════════════════════════════════════

import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const FLOW_SECRET      = process.env.FLOW_SECRET;
const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY; // Service role key
const RESEND_KEY       = process.env.RESEND_KEY;

function verificarFirma(params, secret) {
  const { s, ...rest } = params;
  const keys = Object.keys(rest).sort();
  const toSign = keys.map(k => k + rest[k]).join('');
  const esperado = crypto.createHmac('sha256', secret).update(toSign).digest('hex');
  return s === esperado;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const params = req.body;

    // Verificar firma Flow.cl
    if (!verificarFirma(params, FLOW_SECRET)) {
      console.error('Firma inválida — posible fraude');
      return res.status(401).json({ error: 'Firma inválida' });
    }

    const { token, commerceOrder, status } = params;
    // status: 1=pendiente, 2=pagado, 3=rechazado, 4=anulado
    if (status !== '2') {
      console.log(`Pago no confirmado. Status: ${status}, Orden: ${commerceOrder}`);
      return res.status(200).json({ ok: true, msg: 'Pago no exitoso' });
    }

    // Obtener detalle del pago desde Flow
    const flowRes = await fetch(`https://sandbox.flow.cl/api/payment/getStatus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        apiKey: process.env.FLOW_API_KEY,
        token,
        s: crypto.createHmac('sha256', FLOW_SECRET)
          .update(`apiKey${process.env.FLOW_API_KEY}token${token}`)
          .digest('hex'),
      }),
    });
    const flowData = await flowRes.json();

    // Registrar en Supabase
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE);

    // Actualizar pagos_flow
    await sb.from('pagos_flow')
      .update({
        status: 'pagado',
        flow_token: token,
        flow_order: flowData.flowOrder,
        fecha_pago: new Date().toISOString(),
        monto_cobrado: flowData.amount,
      })
      .eq('orden_id', commerceOrder);

    // Obtener datos de la orden pendiente
    const { data: ordenData } = await sb.from('pagos_flow')
      .select('*')
      .eq('orden_id', commerceOrder)
      .single();

    if (ordenData) {
      // Registrar en tabla pagos (GC del mes)
      await sb.from('pagos').insert({
        comunidad_id: ordenData.comunidad_id,
        unidad_id:    ordenData.unidad_id,
        usuario_id:   ordenData.usuario_id,
        month:        ordenData.mes,
        amount:       ordenData.monto_base,
        method:       'flow',
        date:         new Date().toISOString().split('T')[0],
        flow_token:   token,
        created_at:   new Date().toISOString(),
      });

      // Auditoría
      await sb.from('registros_de_auditoría').insert({
        comunidad_id: ordenData.comunidad_id,
        accion:       'PAGO_FLOW_CONFIRMADO',
        descripcion:  `Pago Flow confirmado · Orden ${commerceOrder} · $${ordenData.monto_total}`,
        created_at:   new Date().toISOString(),
      });

      // Enviar email comprobante via Resend
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
            subject: `✅ Comprobante de pago GC ${ordenData.mes} — Vecinoo`,
            html: `
              <div style="font-family:Arial;max-width:500px;margin:0 auto;padding:30px">
                <h2 style="color:#0F172A">✅ Pago confirmado</h2>
                <p>Tu pago de gastos comunes fue procesado exitosamente.</p>
                <table style="width:100%;border-collapse:collapse;margin:20px 0">
                  <tr style="border-bottom:1px solid #eee">
                    <td style="padding:8px 0;color:#6b7280">Período</td>
                    <td style="padding:8px 0;font-weight:bold">${ordenData.mes}</td>
                  </tr>
                  <tr style="border-bottom:1px solid #eee">
                    <td style="padding:8px 0;color:#6b7280">Monto GC</td>
                    <td style="padding:8px 0;font-weight:bold">$${ordenData.monto_base?.toLocaleString('es-CL')}</td>
                  </tr>
                  <tr style="border-bottom:1px solid #eee">
                    <td style="padding:8px 0;color:#6b7280">Cargo digital</td>
                    <td style="padding:8px 0">$${ordenData.cargo_plataforma?.toLocaleString('es-CL')}</td>
                  </tr>
                  <tr>
                    <td style="padding:8px 0;font-weight:bold">Total pagado</td>
                    <td style="padding:8px 0;font-weight:bold;color:#2E766B">$${ordenData.monto_total?.toLocaleString('es-CL')}</td>
                  </tr>
                </table>
                <p style="font-size:12px;color:#9ca3af">N° Orden: ${commerceOrder}<br>Procesado por Flow.cl · Vecinoo.cl</p>
              </div>
            `,
          }),
        }).catch(e => console.error('Error email:', e));
      }
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Error webhook:', err);
    return res.status(500).json({ error: err.message });
  }
}
