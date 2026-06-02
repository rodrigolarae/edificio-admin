/**
 * /api/send-email.js
 * Vercel Serverless Function — Email via Resend
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  const { to, subject, html, from } = req.body;
  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'Faltan campos: to, subject, html' });
  }
  if (!to.includes('@')) {
    return res.status(400).json({ error: 'Email destinatario inválido' });
  }
  const apiKey = process.env.RESEND_KEY;
  if (!apiKey) {
    console.error('[send-email] RESEND_KEY no configurada');
    return res.status(500).json({ error: 'Servidor de emails no configurado' });
  }
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: from || 'Vecinoo <noreply@vecinoo.cl>',
        to: [to],
        subject,
        html,
      }),
    });
    const data = await response.json();
    if (!response.ok) {
      console.error('[send-email] Resend error:', data);
      return res.status(response.status).json({ error: data.message || 'Error enviando email' });
    }
    return res.status(200).json({ ok: true, id: data.id });
  } catch (error) {
    console.error('[send-email] Excepción:', error.message);
    return res.status(500).json({ error: 'Error interno: ' + error.message });
  }
}
