// api/send-email.js
// Edge Function de Vercel — envía correos usando Resend.
// La API key vive en la variable de entorno RESEND_KEY (Vercel → Settings → Environment Variables),
// nunca en el frontend ni en este archivo.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const { to, subject, html, from } = req.body || {};

  if (!to || !subject || !html) {
    return res.status(400).json({ error: 'Faltan campos: to, subject y html son obligatorios' });
  }

  const RESEND_KEY = process.env.RESEND_KEY;
  if (!RESEND_KEY) {
    console.error('[send-email] RESEND_KEY no está configurada en Vercel');
    return res.status(500).json({ error: 'Servicio de correo no configurado' });
  }

  try {
    const resendRes = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: from || 'Vecinoo <notificaciones@vecinoo.cl>',
        to: [to],
        subject,
        html,
      }),
    });

    const data = await resendRes.json();

    if (!resendRes.ok) {
      console.error('[send-email] Error de Resend:', data);
      return res.status(resendRes.status).json({ error: data.message || 'Error al enviar el correo' });
    }

    return res.status(200).json({ success: true, id: data.id });
  } catch (e) {
    console.error('[send-email] Error inesperado:', e);
    return res.status(500).json({ error: e.message || 'Error interno al enviar el correo' });
  }
}
