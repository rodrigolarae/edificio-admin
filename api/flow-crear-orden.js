// ══════════════════════════════════════════════════════════════
// Vecinoo — Edge Function: /api/flow-crear-orden
// Crea una orden de pago en Flow.cl con firma HMAC-SHA256
// Desplegar en Vercel junto al index.html
// ══════════════════════════════════════════════════════════════

import crypto from 'crypto';

const FLOW_API_URL = process.env.FLOW_API_URL || 'https://sandbox.flow.cl/api';
const FLOW_API_KEY = process.env.FLOW_API_KEY;
const FLOW_SECRET  = process.env.FLOW_SECRET;
const CARGO_PCT    = parseFloat(process.env.FLOW_CARGO_PCT || '5');

// Firma HMAC-SHA256 requerida por Flow.cl
function firmarParams(params, secret) {
  // Ordenar params alfabéticamente
  const keys = Object.keys(params).sort();
  const toSign = keys.map(k => k + params[k]).join('');
  return crypto.createHmac('sha256', secret).update(toSign).digest('hex');
}

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });

  try {
    const {
      commerceOrder, subject, amount, email,
      urlReturn, urlConfirmation,
      comunidadId, unidadId, mes, montoBase, cargoPlatf,
    } = req.body;

    if (!commerceOrder || !amount || !email) {
      return res.status(400).json({ error: 'Datos incompletos' });
    }

    // Calcular cargo Vecinoo sobre el monto
    const montoConCargo = Math.round(amount * (1 + CARGO_PCT / 100));

    // Parámetros para Flow.cl
    const params = {
      apiKey:          FLOW_API_KEY,
      commerceOrder:   commerceOrder,
      subject:         subject || `Pago GC ${mes}`,
      currency:        'CLP',
      amount:          montoConCargo,
      email:           email,
      urlReturn:       urlReturn,
      urlConfirmation: urlConfirmation,
    };

    // Firmar
    params.s = firmarParams(params, FLOW_SECRET);

    // Llamar a Flow.cl
    const body = new URLSearchParams(params).toString();
    const flowRes = await fetch(`${FLOW_API_URL}/payment/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    const flowData = await flowRes.json();

    if (flowData.token && flowData.url) {
      return res.status(200).json({
        token:    flowData.token,
        url:      flowData.url,
        orden:    commerceOrder,
        monto:    montoConCargo,
      });
    } else {
      console.error('Error Flow.cl:', flowData);
      return res.status(500).json({
        error: flowData.message || 'Error al crear orden en Flow.cl',
        code:  flowData.code,
      });
    }
  } catch (err) {
    console.error('Error edge function:', err);
    return res.status(500).json({ error: 'Error interno: ' + err.message });
  }
}
