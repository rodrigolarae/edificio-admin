// api/secure-proxy.js
import { withAuth, supabaseAdmin } from './_lib/supabase.js'

const ALLOWED_TABLES = {
  admin: ['unidades', 'residentes', 'pagos', 'gastos', 'multas', 'trabajadores', 'alertas', 'documentos', 'votaciones', 'votos', 'estacionamientos', 'bodegas', 'reservas', 'mantenimientos', 'audit_logs', 'paquetes', 'planes_pago'],
  presidente: ['unidades', 'residentes', 'pagos', 'gastos', 'multas', 'trabajadores', 'alertas', 'documentos', 'votaciones', 'votos', 'estacionamientos', 'bodegas', 'reservas', 'mantenimientos', 'audit_logs', 'paquetes'],
  tesorero: ['unidades', 'residentes', 'pagos', 'gastos', 'multas', 'trabajadores', 'alertas', 'documentos', 'votaciones', 'votos', 'estacionamientos', 'bodegas', 'reservas', 'mantenimientos', 'audit_logs', 'paquetes'],
  residente: ['unidades', 'residentes', 'pagos', 'gastos', 'multas', 'alertas', 'documentos', 'votaciones', 'votos', 'reservas', 'mantenimientos'],
  conserje: ['unidades', 'residentes', 'alertas', 'reservas', 'mantenimientos', 'paquetes']
}

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' })
    return
  }

  const { table, action, data, filters } = req.body
  const user = req.user
  const allowed = ALLOWED_TABLES[user.rol] || []

  if (!allowed.includes(table)) {
    res.status(403).json({ error: 'Tabla no permitida para tu rol' })
    return
  }

  try {
    let query = supabaseAdmin.from(table)

    // Siempre filtrar por comunidad_id (excepto superadmin)
    if (user.rol !== 'superadmin' && table !== 'comunidades') {
      query = query.eq('comunidad_id', user.comunidad_id)
    }

    let result
    if (action === 'select') {
      if (filters) {
        Object.entries(filters).forEach(([k, v]) => { query = query.eq(k, v) })
      }
      result = await query.select('*').order('created_at', { ascending: false }).limit(200)
    } else if (action === 'insert') {
      // Forzar comunidad_id del usuario
      const insertData = { ...data, comunidad_id: user.comunidad_id }
      result = await query.insert(insertData).select()
    } else if (action === 'update') {
      result = await query.update(data).eq('id', filters.id).select()
    } else if (action === 'delete') {
      result = await query.delete().eq('id', filters.id)
    } else {
      res.status(400).json({ error: 'Acción no válida' })
      return
    }

    if (result.error) throw result.error
    res.status(200).json({ data: result.data })
  } catch (err) {
    console.error('Secure proxy error:', err)
    res.status(500).json({ error: 'Error interno' })
  }
}

export default withAuth(handler)
