import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

export default function App() {
  const [session, setSession] = useState(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [recursos, setRecursos] = useState([]);
  const [nuevoTitulo, setNuevoTitulo] = useState('');
  const [nuevaCategoria, setNuevaCategoria] = useState('Aulas Informatica');
  const [cantidad, setCantidad] = useState(1);
  const [colegioId, setColegioId] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  // Detectar si venimos redirigidos desde Google OAuth (#access_token=...)
  useEffect(() => {
    const hash = window.location.hash;
    if (!hash) return;

    const params = new URLSearchParams(hash.substring(1));
    const accessToken = params.get('access_token');
    const errorDesc = params.get('error_description');

    if (errorDesc) {
      setError(decodeURIComponent(errorDesc.replace(/\+/g, ' ')));
      window.history.replaceState(null, '', window.location.pathname);
      return;
    }

    if (accessToken) {
      setCargando(true);
      fetch(`${API_URL}/auth/v1/user`, {
        headers: {
          apikey: ANON_KEY,
          Authorization: `Bearer ${accessToken}`,
        },
      })
        .then((res) => {
          if (!res.ok) throw new Error('No se pudo validar la sesión de Google');
          return res.json();
        })
        .then((user) => {
          setSession({ access_token: accessToken, user });
          window.history.replaceState(null, '', window.location.pathname);
        })
        .catch((err) => setError(err.message))
        .finally(() => setCargando(false));
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setCargando(true);
    try {
      const res = await fetch(`${API_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error_description || data.msg || 'Error de acceso');
      setSession(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  };

  const handleGoogleLogin = () => {
    setError('');
    const redirectTo = encodeURIComponent(window.location.origin);
    window.location.href = `${API_URL}/auth/v1/authorize?provider=google&redirect_to=${redirectTo}&prompt=select_account`;
  };

  useEffect(() => {
    if (!session) return;

    const cargarDatos = async () => {
      const headers = {
        apikey: ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
      };

      const resPerfil = await fetch(`${API_URL}/rest/v1/perfiles?select=colegio_id,nombre_completo,rol`, { headers });
      const perfiles = await resPerfil.json();
      if (perfiles.length > 0) setColegioId(perfiles[0].colegio_id);

      const resRecursos = await fetch(`${API_URL}/rest/v1/recursos_colegio?select=*,colegios(nombre)&order=created_at.desc`, { headers });
      const lista = await resRecursos.json();
      if (Array.isArray(lista)) setRecursos(lista);
    };

    cargarDatos();
  }, [session]);

  const handleCrearRecurso = async (e) => {
    e.preventDefault();
    if (!colegioId) {
      setError('Tu usuario no tiene un colegio asignado en la tabla perfiles.');
      return;
    }
    setError('');
    const res = await fetch(`${API_URL}/rest/v1/recursos_colegio`, {
      method: 'POST',
      headers: {
        apikey: ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      },
      body: JSON.stringify({
        colegio_id: colegioId,
        categoria: nuevaCategoria,
        titulo: nuevoTitulo,
        cantidad: Number(cantidad),
        actualizado_por: session.user.id,
      }),
    });

    if (res.ok) {
      const [creado] = await res.json();
      setRecursos([creado, ...recursos]);
      setNuevoTitulo('');
      setCantidad(1);
    } else {
      const errData = await res.json();
      setError(errData.message || 'No se pudo guardar el registro (revisa RLS)');
    }
  };

  if (!session) {
    return (
      <div style={{ maxWidth: 400, margin: '60px auto', fontFamily: 'sans-serif' }}>
        <h2>Portal Centralizado de Colegios</h2>
        <p style={{ color: '#555' }}>Acceso restringido por centro educativo (RLS)</p>
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="email"
            placeholder="Correo del gestor"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ padding: 10 }}
          />
          <input
            type="password"
            placeholder="Contraseña"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ padding: 10 }}
          />
          <button type="submit" disabled={cargando} style={{ padding: 10, cursor: 'pointer' }}>
            {cargando ? 'Conectando...' : 'Iniciar sesión'}
          </button>
          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={cargando}
            style={{
              padding: 10,
              cursor: 'pointer',
              background: '#fff',
              color: '#333',
              border: '1px solid #ccc',
              fontWeight: 'bold',
            }}
          >
            Continuar con Google
          </button>
        </form>
        {error && <p style={{ color: 'red', marginTop: 12 }}>{error}</p>}
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 800, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Gestión de Recursos del Centro</h2>
        <button onClick={() => { setSession(null); setRecursos([]); setColegioId(null); }}>
          Cerrar sesión
        </button>
      </div>
      <p>Usuario: <strong>{session.user.email}</strong></p>

      <form onSubmit={handleCrearRecurso} style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        <select value={nuevaCategoria} onChange={(e) => setNuevaCategoria(e.target.value)} style={{ padding: 8 }}>
          <option value="Aulas Informatica">Aulas Informática</option>
          <option value="Equipamiento">Equipamiento</option>
          <option value="Incidencias">Incidencias</option>
        </select>
        <input
          type="text"
          placeholder="Descripción (ej. Aula Redes 2)"
          value={nuevoTitulo}
          onChange={(e) => setNuevoTitulo(e.target.value)}
          required
          style={{ flex: 1, padding: 8 }}
        />
        <input
          type="number"
          min="1"
          value={cantidad}
          onChange={(e) => setCantidad(e.target.value)}
          style={{ width: 70, padding: 8 }}
        />
        <button type="submit" style={{ padding: '8px 16px' }}>Añadir</button>
      </form>

      {error && <p style={{ color: 'red' }}>{error}</p>}

      <table border="1" cellPadding="10" style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ background: '#f4f4f4' }}>
            <th>Centro</th>
            <th>Categoría</th>
            <th>Recurso / Título</th>
            <th>Cantidad</th>
            <th>Estado</th>
          </tr>
        </thead>
        <tbody>
          {recursos.map((r) => (
            <tr key={r.id}>
              <td>{r.colegios?.nombre || 'Mi centro'}</td>
              <td>{r.categoria}</td>
              <td>{r.titulo}</td>
              <td>{r.cantidad}</td>
              <td>{r.estado}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
