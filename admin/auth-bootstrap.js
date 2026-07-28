import { getSession, getCurrentUser, onAuthStateChange, signInWithEmail, signOut } from './supabase-auth.js';

const SUPER_ADMIN_EMAIL = 'mikro970328@gmail.com';

function setMessage(text, ok = false) {
  const el = document.getElementById('loginMsg');
  if (!el) return;
  el.textContent = text;
  el.className = `msg ${ok ? 'ok' : 'bad'}`;
}

function showLogin() {
  document.getElementById('loginCard')?.classList.remove('hidden');
  document.getElementById('appShell')?.classList.add('hidden');
}

function showApp(user) {
  window.currentUser = {
    id: user.id,
    username: user.email,
    email: user.email,
    role: user.email === SUPER_ADMIN_EMAIL ? 'master_admin' : 'admin',
  };

  const currentUserEl = document.getElementById('currentUser');
  const currentRoleEl = document.getElementById('currentRole');
  const adminNav = document.getElementById('adminNav');

  if (currentUserEl) currentUserEl.textContent = user.email || '';
  if (currentRoleEl) currentRoleEl.textContent = user.email === SUPER_ADMIN_EMAIL ? 'Administrador maestro' : 'Administrador';
  if (adminNav) adminNav.classList.toggle('hidden', user.email !== SUPER_ADMIN_EMAIL);

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
    showApp(user);
  } catch (error) {
    console.error(error);
    showLogin();
    setMessage('No se pudo verificar la sesión.');
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const loginButton = document.getElementById('login');
  const emailInput = document.getElementById('username');
  const passwordInput = document.getElementById('password');
  const logoutButton = document.getElementById('logout');

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
      const { user } = await signInWithEmail(email, password);
      showApp(user);
      setMessage('');
    } catch (error) {
      console.error(error);
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
    } finally {
      showLogin();
    }
  });

  onAuthStateChange((_event, session) => {
    if (!session) showLogin();
  });

  bootstrap();
});
