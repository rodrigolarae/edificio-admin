// api/_lib/supabase.js
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Faltan variables de entorno SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY')
}

export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

// Verificador de JWT para proteger rutas
export async function verifyUser(req) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace('Bearer ', '')
  
  if (!token) return { user: null, error: 'No autorizado' }
  
  const { data: { user }, error } = await supabaseAdmin.auth.getUser(token)
  if (error || !user) return { user: null, error: 'Token inválido' }
  
  // Traer perfil (rol, comunidad_id) desde tabla perfiles
  const { data: perfil } = await supabaseAdmin
    .from('perfiles')
    .select('rol, comunidad_id, unidad_id')
    .eq('id', user.id)
    .single()
    
  return { user: { ...user, ...perfil }, error: null }
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
