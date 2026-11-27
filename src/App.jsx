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
        const resUser = await fetch(`${API_URL}/auth/v1/user`,
