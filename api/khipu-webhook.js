// ══════════════════════════════════════════════════════════════
// Vecinoo — Edge Function: /api/khipu-webhook
// Khipu llama aquí cuando el pago es confirmado
// ══════════════════════════════════════════════════════════════
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY;
const RESEND_KEY       = process.env.RESEND_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  try {
    const { api_version, notification_token, receiver_id, subject,
      amount, currency, transaction_id, payment_id, status } = req.body;

    if (status !== 'done') {
      return res.status(200).json({ ok: true, msg: 'Pago no completado: ' + status });
    }

    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE);

    // Actualizar pagos_khipu
    await sb.from('pagos_khipu')
      .update({ status: 'pagado', fecha_pago: new Date().toISOString() })
      .eq('orden_id', transaction_id);

    // Obtener datos de la orden
    const { data: orden } = await sb.from('pagos_khipu')
      .select('*').eq('orden_id', transaction_id).single();

    if (orden) {
      // Registrar en tabla pagos
      await sb.from('pagos').insert({
        comunidad_id: orden.comunidad_id,
        unidad_id:    orden.unidad_id,
        month:        orden.mes,
        amount:       orden.monto_base,
        method:       'khipu',
        date:         new Date().toISOString().split('T')[0],
        created_at:   new Date().toISOString(),
      });

      // Auditoría
      await sb.from('registros_de_auditoría').insert({
        comunidad_id: orden.comunidad_id,
        accion:       'PAGO_KHIPU_CONFIRMADO',
        descripcion:  `Pago Khipu confirmado · ${transaction_id} · $${orden.monto_total}`,
        created_at:   new Date().toISOString(),
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('Khipu webhook error:', err);
    return res.status(500).json({ error: err.message });
  }
}
