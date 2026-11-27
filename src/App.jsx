import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

const DOMINIOS_PERMITIDOS = ['@escolabalmes.com', '@alumne.escolabalmes.com'];

const esCorreoCorporativo = (correo) => {
  if (!correo) return false;
  const limpio = correo.trim().toLowerCase();
  return DOMINIOS_PERMITIDOS.some((dominio) => limpio.endsWith(dominio));
};

// Decodifica el payload del JWT para leer el nivel de autenticación ('aal1' o 'aal2')
const obtenerNivelAAL = (token) => {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return payload.aal || 'aal1';
  } catch {
    return 'aal1';
  }
};

export default function App() {
  const [session, setSession] = useState(null);
  const [mfaVerified, setMfaVerified] = useState(false);

  // Estados para configuración / desafío MFA
  const [mfaStep, setMfaStep] = useState('checking'); // 'checking' | 'enroll' | 'verify'
  const [factorId, setFactorId] = useState(null);
  const [qrCode, setQrCode] = useState('');
  const [totpSecret, setTotpSecret] = useState('');
  const [codigoMfa, setCodigoMfa] = useState('');

  // Estados de login y panel
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [recursos, setRecursos] = useState([]);
  const [nuevoTitulo, setNuevoTitulo] = useState('');
  const [nuevaCategoria, setNuevaCategoria] = useState('Aulas Informatica');
  const [cantidad, setCantidad] = useState(1);
  const [colegioId, setColegioId] = useState(null);
  const [error, setError] = useState('');
  const [cargando, setCargando] = useState(false);

  const cerrarSesion = () => {
    setSession(null);
    setMfaVerified(false);
    setMfaStep('checking');
    setFactorId(null);
    setQrCode('');
    setTotpSecret('');
    setCodigoMfa('');
    setRecursos([]);
    setColegioId(null);
    setError('');
  };

  // Inicia la sesión en estado aal1 y comprueba si ya viene con aal2
  const iniciarFlujoSesion = (sessionData) => {
    const correoUsuario = sessionData?.user?.email;
    if (correoUsuario && !esCorreoCorporativo(correoUsuario)) {
      setError('Acceso denegado: solo se permiten cuentas corporativas (@escolabalmes.com o @alumne.escolabalmes.com).');
      return;
    }

    const aal = obtenerNivelAAL(sessionData.access_token);
    setSession(sessionData);
    setMfaVerified(aal === 'aal2');
  };

  // 1. Detectar retorno desde Google OAuth (#access_token=...)
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
          window.history.replaceState(null, '', window.location.pathname);
          iniciarFlujoSesion({ access_token: accessToken, user });
        })
        .catch((err) => setError(err.message))
        .finally(() => setCargando(false));
    }
  }, []);

  // 2. Preparar enrolamiento QR o verificación de 6 dígitos cuando session está en aal1
  useEffect(() => {
    if (!session || mfaVerified) return;

    const prepararMFA = async () => {
      setMfaStep('checking');
      setError('');
      const headers = {
        apikey: ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      };

      try {
        // Consultar factores del usuario
        const resUser = await fetch(`${API_URL}/auth/v1/user`, { headers });
        const userData = await resUser.json();
        const factores = userData.factors || [];

        const factorVerificado = factores.find((f) => f.factor_type === 'totp' && f.status === 'verified');

        if (factorVerificado) {
          setFactorId(factorVerificado.id);
          setMfaStep('verify');
          return;
        }

        // Limpiar factores TOTP previos sin verificar para evitar duplicados
        const factoresPendientes = factores.filter((f) => f.factor_type === 'totp' && f.status === 'unverified');
        for (const f of factoresPendientes) {
          await fetch(`${API_URL}/auth/v1/factors/${f.id}`, {
            method: 'DELETE',
            headers,
          });
        }

        // Crear nuevo factor TOTP (genera el QR)
        const resEnroll = await fetch(`${API_URL}/auth/v1/factors`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            factor_type: 'totp',
            friendly_name: 'Authenticator Centro',
          }),
        });
        const enrollData = await resEnroll.json();
        if (!resEnroll.ok) {
          throw new Error(enrollData.msg || enrollData.error_description || 'No se pudo iniciar la configuración MFA');
        }

        const rawQr = enrollData.totp.qr_code;
        setFactorId(enrollData.id);
        setQrCode(rawQr.startsWith('data:') ? rawQr : `data:image/svg+xml;utf8,${encodeURIComponent(rawQr)}`);
        setTotpSecret(enrollData.totp.secret);
        setMfaStep('enroll');
      } catch (err) {
        setError(err.message);
      }
    };

    prepararMFA();
  }, [session, mfaVerified]);

  // 3. Validar código TOTP de 6 dígitos y elevar la sesión a aal2
  const handleVerificarMFA = async (e) => {
    e.preventDefault();
    if (!factorId || codigoMfa.trim().length !== 6) {
      setError('Introduce el código numérico de 6 dígitos de tu aplicación Authenticator.');
      return;
    }

    setCargando(true);
    setError('');
    const headers = {
      apikey: ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    };

    try {
      // Crear desafío (challenge)
      const resChallenge = await fetch(`${API_URL}/auth/v1/factors/${factorId}/challenge`, {
        method: 'POST',
        headers,
      });
      const challengeData = await resChallenge.json();
      if (!resChallenge.ok) {
        throw new Error(challengeData.msg || 'Error al crear el desafío MFA');
      }

      // Verificar código
      const resVerify = await fetch(`${API_URL}/auth/v1/factors/${factorId}/verify`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          challenge_id: challengeData.id,
          code: codigoMfa.trim(),
        }),
      });
      const verifyData = await resVerify.json();
      if (!resVerify.ok) {
        throw new Error(verifyData.msg || verifyData.error_description || 'Código incorrecto o caducado');
      }

      // Actualizar sesión con el nuevo JWT aal2
      setSession({
        ...session,
        access_token: verifyData.access_token,
        refresh_token: verifyData.refresh_token,
        user: verifyData.user || session.user,
      });
      setCodigoMfa('');
      setMfaVerified(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  };

  // Login con correo y contraseña
  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');

    if (!esCorreoCorporativo(email)) {
      setError('Solo se permite el acceso con correos @escolabalmes.com o @alumne.escolabalmes.com.');
      return;
    }

    setCargando(true);
    try {
      const res = await fetch(`${API_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: {
          apikey: ANON_KEY,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error_description || data.msg || 'Error de acceso');
      iniciarFlujoSesion(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setCargando(false);
    }
  };

  // Login SSO con Google
  const handleGoogleLogin = () => {
    setError('');
    const redirectTo = encodeURIComponent(window.location.origin);
    window.location.href = `${API_URL}/auth/v1/authorize?provider=google&redirect_to=${redirectTo}&prompt=select_account`;
  };

  // 4. Cargar perfil y recursos (solo se ejecuta cuando mfaVerified === true / aal2)
  useEffect(() => {
    if (!session || !mfaVerified) return;

    const cargarDatos = async () => {
      const headers = {
        apikey: ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
      };

      const resPerfil = await fetch(`${API_URL}/rest/v1/perfiles?select=colegio_id,nombre_completo,rol`, { headers });
      const perfiles = await resPerfil.json();
      if (Array.isArray(perfiles) && perfiles.length > 0) {
        setColegioId(perfiles[0].colegio_id);
      }

      const resRecursos = await fetch(`${API_URL}/rest/v1/recursos_colegio?select=*,colegios(nombre)&order=created_at.desc`, { headers });
      const lista = await resRecursos.json();
      if (Array.isArray(lista)) setRecursos(lista);
    };

    cargarDatos();
  }, [session, mfaVerified]);

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

  // VISTA 1: Login inicial (sin sesión)
  if (!session) {
    return (
      <div style={{ maxWidth: 400, margin: '60px auto', fontFamily: 'sans-serif' }}>
        <h2>Portal Centralizado de Colegios</h2>
        <p style={{ color: '#555' }}>Acceso restringido a cuentas corporativas (@escolabalmes.com)</p>
        <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <input
            type="email"
            placeholder="Correo corporativo del gestor"
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

  // VISTA 2: Segundo factor MFA obligatorio (sesión aal1 pendiente de elevar a aal2)
  if (!mfaVerified) {
    return (
      <div style={{ maxWidth: 420, margin: '60px auto', fontFamily: 'sans-serif', border: '1px solid #ddd', padding: 24, borderRadius: 8 }}>
        <h2>Verificación en dos pasos (MFA)</h2>
        <p style={{ color: '#555', fontSize: 14 }}>
          Usuario: <strong>{session.user.email}</strong>
        </p>

        {mfaStep === 'checking' && <p>Comprobando configuración de seguridad...</p>}

        {mfaStep === 'enroll' && (
          <div>
            <p style={{ fontSize: 14 }}>
              Es tu primer acceso con MFA obligatorio. Escanea este código QR con <strong>Google Authenticator</strong> o <strong>Microsoft Authenticator</strong>:
            </p>
            {qrCode && (
              <div style={{ textAlign: 'center', margin: '16px 0' }}>
                <img src={qrCode} alt="Código QR MFA" style={{ width: 200, height: 200, border: '1px solid #eee' }} />
              </div>
            )}
            {totpSecret && (
              <p style={{ fontSize: 12, color: '#666', wordBreak: 'break-all' }}>
                Clave manual: <code>{totpSecret}</code>
              </p>
            )}
          </div>
        )}

        {mfaStep === 'verify' && (
          <p style={{ fontSize: 14 }}>
            Introduce el código temporal de 6 dígitos generado por tu aplicación Authenticator:
          </p>
        )}

        {(mfaStep === 'enroll' || mfaStep === 'verify') && (
          <form onSubmit={handleVerificarMFA} style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 12 }}>
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              placeholder="000000"
              value={codigoMfa}
              onChange={(e) => setCodigoMfa(e.target.value.replace(/\D/g, ''))}
              required
              style={{ padding: 10, fontSize: 18, letterSpacing: 6, textAlign: 'center' }}
            />
            <button type="submit" disabled={cargando} style={{ padding: 10, cursor: 'pointer', fontWeight: 'bold' }}>
              {cargando ? 'Verificando...' : 'Verificar y acceder'}
            </button>
          </form>
        )}

        {error && <p style={{ color: 'red', marginTop: 12 }}>{error}</p>}

        <button
          type="button"
          onClick={cerrarSesion}
          style={{ marginTop: 16, background: 'transparent', border: 'none', color: '#666', textDecoration: 'underline', cursor: 'pointer' }}
        >
          Cancelar y volver al inicio
        </button>
      </div>
    );
  }

  // VISTA 3: Panel principal (sesión verificada con nivel aal2)
  return (
    <div style={{ maxWidth: 800, margin: '40px auto', fontFamily: 'sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2>Gestión de Recursos del Centro</h2>
        <button onClick={cerrarSesion}>Cerrar sesión</button>
      </div>
      <p>
        Usuario: <strong>{session.user.email}</strong> <span style={{ color: 'green', fontSize: 12 }}>(MFA verificado · AAL2)</span>
      </p>

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
