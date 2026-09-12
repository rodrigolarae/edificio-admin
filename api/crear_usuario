// api/crear-usuario.js
// Da de alta a una persona (residente, presidente, tesorero, conserje o admin)
// dentro de una comunidad. Crea (o reutiliza) su cuenta real de Supabase Auth
// y le envía un correo de invitación para que defina su propia contraseña —
// nunca se genera ni se guarda una contraseña por defecto.
import { withAuth, supabaseAdmin } from './_lib/supabase.js'

const ROLES_VALIDOS = ['admin', 'presidente', 'tesorero', 'conserje', 'residente']

async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método no permitido' })
    return
  }

  const { comunidad_id, nombre, rut, email, telefono, rol, unidad_id } = req.body || {}

  if (!comunidad_id || !nombre || !email || !rol) {
    res.status(400).json({ error: 'Faltan datos obligatorios (comunidad_id, nombre, email, rol)' })
    return
  }
  if (!ROLES_VALIDOS.includes(rol)) {
    res.status(400).json({ error: 'Rol inválido' })
    return
  }
  const emailNorm = String(email).trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
    res.status(400).json({ error: 'Correo inválido' })
    return
  }

  // Solo el superadmin, o alguien de la directiva de ESA MISMA comunidad, puede crear usuarios ahí.
  if (req.user.rol !== 'superadmin' && req.user.comunidad_id !== comunidad_id) {
    res.status(403).json({ error: 'No tienes permiso para crear usuarios en esta comunidad' })
    return
  }

  try {
    // 1) Crear la cuenta de autenticación e invitarla por correo (define su propia clave).
    //    Si el correo ya tenía una cuenta (ej. es residente en otra comunidad también),
    //    reutilizamos esa cuenta en vez de fallar.
    let authId
    const siteUrl = process.env.SITE_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '')
    const { data: invited, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      emailNorm,
      siteUrl ? { redirectTo: siteUrl } : undefined
    )

    if (inviteErr) {
      const yaExiste = /already.*registered|already.*exists/i.test(inviteErr.message || '')
      if (!yaExiste) {
        res.status(500).json({ error: 'No se pudo enviar la invitación: ' + inviteErr.message })
        return
      }
      // Buscar la cuenta existente por correo
      const { data: list, error: listErr } = await supabaseAdmin.auth.admin.listUsers()
      if (listErr) {
        res.status(500).json({ error: 'No se pudo verificar la cuenta existente: ' + listErr.message })
        return
      }
      const existente = list.users.find(u => (u.email || '').toLowerCase() === emailNorm)
      if (!existente) {
        res.status(500).json({ error: 'El correo ya está en uso pero no se pudo encontrar la cuenta' })
        return
      }
      authId = existente.id
    } else {
      authId = invited.user.id
    }

    // 2) Crear (o actualizar) su perfil en esta comunidad
    const { data: usuario, error: dbErr } = await supabaseAdmin
      .from('usuarios')
      .upsert(
        {
          auth_id: authId,
          comunidad_id,
          nombre,
          rut: rut || null,
          email: emailNorm,
          phone: telefono || null,
          rol,
          unidad_id: unidad_id || null,
          activo: true
        },
        { onConflict: 'auth_id,comunidad_id' }
      )
      .select()
      .single()

    if (dbErr) {
      res.status(500).json({ error: 'La cuenta se creó pero no se pudo guardar el perfil: ' + dbErr.message })
      return
    }

    res.status(200).json({ ok: true, usuario })
  } catch (e) {
    res.status(500).json({ error: 'Error inesperado: ' + e.message })
  }
}

export default withAuth(handler, ['admin', 'presidente', 'tesorero', 'superadmin'])
