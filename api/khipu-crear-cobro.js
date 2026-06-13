// ══════════════════════════════════════════════════════════════
// Vecinoo — Edge Function: /api/khipu-crear-cobro
// Crea un cobro en Khipu.com — dinero va DIRECTO al edificio
// ══════════════════════════════════════════════════════════════
import crypto from 'crypto';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL     = process.env.SUPABASE_URL;
const SUPABASE_SERVICE = process.env.SUPABASE_SERVICE_KEY;

function firmarKhipu(method, url, secret, params) {
  const paramStr = new URLSearchParams(
    Object.entries(params).sort(([a],[b]) => a.localeCompare(b))
  ).toString();
  const toSign = `${method}&${encodeURIComponent(url)}&${encodeURIComponent(paramStr)}`;
  return crypto.createHmac('sha256', secret).update(toSign).digest('hex');
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Metodo no permitido' });

  try {
    const { receiverId, secret, subject, amount, currency,
      email, orderId, returnUrl, cancelUrl, notifyUrl,
      comunidadId, unidadId, mes, montoBase } = req.body;

    if (!receiverId || !secret || !amount) {
      return res.status(400).json({ error: 'Faltan: receiverId, secret, amount' });
    }

    const KHIPU_API = 'https://khipu.com/api/2.0';
    const endpoint  = `${KHIPU_API}/payments`;

    const params = {
      receiver_id:        receiverId,
      subject,
      amount:             amount.toString(),
      currency:           currency || 'CLP',
      transaction_id:     orderId,
      return_url:         returnUrl,
      cancel_url:         cancelUrl,
      notify_url:         notifyUrl,
      notify_api_version: '1.3',
    };
    if (email) params.payer_email = email;

    const firma = firmarKhipu('POST', endpoint, secret, params);

    const khipuRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/x-www-form-urlencoded',
        'Authorization': `${receiverId}:${firma}`,
      },
      body: new URLSearchParams(params).toString(),
    });

    const data = await khipuRes.json();

    if (!khipuRes.ok || !data.payment_url) {
      return res.status(500).json({ error: data.message || 'Error Khipu' });
    }

    // Guardar en Supabase
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE);
    await sb.from('pagos_khipu').insert({
      payment_id: data.payment_id, orden_id: orderId,
      comunidad_id: comunidadId, unidad_id: unidadId, mes,
      monto_base: montoBase, monto_total: amount,
      status: 'pendiente', payment_url: data.payment_url,
      created_at: new Date().toISOString(),
    }).catch(() => null);

    return res.status(200).json({
      payment_url: data.payment_url,
      simplified_transfer_url: data.simplified_transfer_url,
      payment_id: data.payment_id,
    });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
