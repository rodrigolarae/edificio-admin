// api/keepalive.js
// Tarea diaria (Vercel Cron) que hace una consulta mínima a Supabase para que el proyecto
// del plan gratuito no se pause por inactividad. Es un paliativo: no reemplaza al plan Pro.
// Solo responde si la llamada trae el secreto CRON_SECRET (Vercel lo envía solo en las
// tareas programadas), así nadie más puede dispararla.
import { timingSafeEqual } from 'crypto'
import { supabaseAdmin } from './_lib/supabase.js'

function secretoValido(req) {
  const secreto = process.env.CRON_SECRET
  if (!secreto) return false                       // sin secreto configurado, nunca se abre
  const recibido = String(req.headers.authorization || '')
  const esperado = `Bearer ${secreto}`
  const a = Buffer.from(recibido)
  const b = Buffer.from(esperado)
  return a.length === b.length && timingSafeEqual(a, b)
}

export default async function handler(req, res) {
  if (!secretoValido(req)) {
    res.status(401).json({ error: 'No autorizado' })
    return
  }
  try {
    const { error, count } = await supabaseAdmin
      .from('comunidades')
      .select('id', { count: 'exact', head: true })
    if (error) {
      console.error('keepalive: error consultando Supabase:', error.message)
      res.status(500).json({ ok: false, error: error.message })
      return
    }
    res.status(200).json({ ok: true, comunidades: count, at: new Date().toISOString() })
  } catch (e) {
    console.error('keepalive: error inesperado:', e)
    res.status(500).json({ ok: false, error: 'Error inesperado' })
  }
}
