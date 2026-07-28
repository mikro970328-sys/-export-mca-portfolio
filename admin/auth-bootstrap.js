import { getSession, getCurrentUser, onAuthStateChange, signInWithEmail, signOut } from './supabase-auth.js';

const SUPER_ADMIN_EMAIL = 'mikro970328@gmail.com';

function setMessage(text, ok = false) {
  const el = document.getElementById('loginMsg');
  if (!el) return;
  el.textContent = text;
  el.className = `msg ${ok ? 'ok' : 'bad'}`;
}

function setLegacyContext(session, user) {
  window.__exportMcaAccessToken = session?.access_token || '';
  window.__exportMcaCurrentUser = user
    ? {
        id: user.id,
        username: user.email,
        email: user.email,
        role: String(user.email || '').toLowerCase() === SUPER_ADMIN_EMAIL ? 'master_admin' : 'admin',
      }
    : null;

  // El panel existente usa variables globales léxicas. Este puente permite
  // migrar la autenticación sin reescribir todavía todos sus módulos.
  window.eval('token = window.__exportMcaAccessToken; currentUser = window.__exportMcaCurrentUser;');
}

function showLogin() {
  setLegacyContext(null, null);
  document.getElementById('loginCard')?.classList.remove('hidden');
  document.getElementById('appShell')?.classList.add('hidden');
}

function showApp(session, user) {
  if (!session?.access_token || !user?.id) {
    showLogin();
    return;
  }

  setLegacyContext(session, user);

  const email = String(user.email || '').toLowerCase();
  const isMaster = email === SUPER_ADMIN_EMAIL;
  const currentUserEl = document.getElementById('currentUser');
  const currentRoleEl = document.getElementById('currentRole');
  const adminNav = document.getElementById('adminNav');

  if (currentUserEl) currentUserEl.textContent = user.email || '';
  if (currentRoleEl) currentRoleEl.textContent = isMaster ? 'Administrador maestro' : 'Administrador';
  if (adminNav) adminNav.classList.toggle('hidden', !isMaster);

  document.getElementById('loginCard')?.classList.add('hidden');
  document.getElementById('appShell')?.classList.remove('hidden');

  if (typeof window.showSection === 'function') window.showSection('dashboardSection');
  if (typeof window.loadAll === 'function') window.loadAll();
}

async function bootstrap() {
  try {
    const session = await getSession();
    if (!session) {
      showLogin();
      return;
    }

    const user = await getCurrentUser();
    showApp(session, user);
  } catch (error) {
    console.error('AUTH_BOOTSTRAP_ERROR', error);
    showLogin();
    setMessage('No se pudo verificar la sesión.');
  }
}

async function exportCsvWithSession(event) {
  event.preventDefault();
  event.stopImmediatePropagation();

  const session = await getSession();
  if (!session?.access_token) {
    showLogin();
    setMessage('La sesión expiró. Inicia sesión nuevamente.');
    return;
  }

  try {
    const response = await fetch('/api/export', {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(data.error || 'No se pudo exportar el archivo');
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `export-mca-operaciones-${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  } catch (error) {
    alert(error.message);
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const loginButton = document.getElementById('login');
  const emailInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const logoutButton = document.getElementById('logout');
  const exportButton = document.getElementById('exportCsv');

  if (emailInput) {
    emailInput.type = 'email';
    emailInput.placeholder = 'correo@empresa.com';
    emailInput.value = SUPER_ADMIN_EMAIL;
  }

  loginButton?.addEventListener('click', async () => {
    const email = emailInput?.value.trim() || '';
    const password = passwordInput?.value || '';

    if (!email || !password) {
      setMessage('Escribe el correo y la contraseña.');
      return;
    }

    loginButton.disabled = true;
    setMessage('Verificando acceso...', true);

    try {
      const { session, user } = await signInWithEmail(email, password);
      showApp(session, user);
      if (passwordInput) passwordInput.value = '';
      setMessage('');
    } catch (error) {
      console.error('AUTH_LOGIN_ERROR', error);
      setMessage('Correo o contraseña incorrectos.');
    } finally {
      loginButton.disabled = false;
    }
  });

  passwordInput?.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') loginButton?.click();
  });

  logoutButton?.addEventListener('click', async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('AUTH_LOGOUT_ERROR', error);
    } finally {
      showLogin();
    }
  });

  exportButton?.addEventListener('click', exportCsvWithSession, true);

  onAuthStateChange(async (event, session) => {
    if (!session) {
      showLogin();
      return;
    }

    try {
      const user = session.user || await getCurrentUser();
      setLegacyContext(session, user);

      if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        showApp(session, user);
      }
    } catch (error) {
      console.error('AUTH_STATE_ERROR', error);
      showLogin();
    }
  });

  bootstrap();
});
