// ══════════════════════════════════════════════════════════════
// Vecinoo — Edge Function: /api/flow-resultado
// Flow redirige al usuario aquí después del pago
// Muestra resultado y redirige de vuelta a la app
// ══════════════════════════════════════════════════════════════

export default async function handler(req, res) {
  const { token, orden } = req.query;

  if (!token) {
    return res.redirect('/?pago=error');
  }

  try {
    // Consultar estado del pago en Flow
    const crypto = await import('crypto');
    const secret = process.env.FLOW_SECRET;
    const apiKey = process.env.FLOW_API_KEY;

    const sig = crypto.default.createHmac('sha256', secret)
      .update(`apiKey${apiKey}token${token}`)
      .digest('hex');

    const flowRes = await fetch(`https://sandbox.flow.cl/api/payment/getStatus`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ apiKey, token, s: sig }),
    });

    const data = await flowRes.json();
    // status 2 = pagado
    if (data.status === 2) {
      return res.redirect(`/?pago=exitoso&orden=${orden}`);
    } else {
      return res.redirect(`/?pago=fallido&orden=${orden}`);
    }
  } catch(e) {
    console.error(e);
    return res.redirect('/?pago=error');
  }
}
