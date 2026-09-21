// api/_lib/supabase.js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Faltan variables de entorno SUPABASE_URL o SUPABASE_SERVICE_KEY')
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

// Verificador de JWT para proteger rutas.
// Busca el perfil de la persona en las 3 tablas reales de la app
// (superadmin, delegados, usuarios) — Vecinoo no usa una tabla "perfiles" única.
export async function verifyUser(req) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace('Bearer ', '')

  if (!token) return { user: null, error: 'No autorizado' }

  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) return { user: null, error: 'Token inválido' }

  // ¿Superadmin?
  const { data: sa } = await supabaseAdmin
    .from('superadmin').select('id').eq('auth_id', user.id).maybeSingle()
  if (sa) return { user: { ...user, rol: 'superadmin', comunidad_id: null }, error: null }

  // ¿Delegado (admin municipal / admin de condominios)?
  const { data: del } = await supabaseAdmin
    .from('delegados').select('id, rol').eq('auth_id', user.id).maybeSingle()
  if (del) return { user: { ...user, rol: del.rol, comunidad_id: null }, error: null }

  // Usuario normal — puede tener perfiles en más de una comunidad
  const { data: perfiles } = await supabaseAdmin
    .from('usuarios').select('id, rol, comunidad_id, unidad_id')
    .eq('auth_id', user.id).eq('activo', true)

  if (perfiles && perfiles.length) {
    return {
      user: { ...user, rol: perfiles[0].rol, comunidad_id: perfiles[0].comunidad_id, unidad_id: perfiles[0].unidad_id, perfiles },
      error: null
    }
  }

  return { user: null, error: 'Tu cuenta no tiene un perfil asignado' }
}

// Middleware simple
export function withAuth(handler, allowedRoles = []) {
  return async (req, res) => {
    const { user, error } = await verifyUser(req)
    if (error) {
      res.status(401).json({ error })
      return
    }
    if (allowedRoles.length > 0 && !allowedRoles.includes(user.rol)) {
      res.status(403).json({ error: 'No tienes permiso para esta acción' })
      return
    }
    req.user = user
    return handler(req, res)
  }
}
