const app = document.getElementById('app');
const userInfo = document.getElementById('userInfo');

let state = {
  token: localStorage.getItem('evv_token'),
  user: JSON.parse(localStorage.getItem('evv_user') || 'null'),
};

async function api(path, opts = {}) {
  opts.headers = opts.headers || {};
  if (state.token) opts.headers['Authorization'] = `Bearer ${state.token}`;
  if (opts.body) opts.headers['Content-Type'] = 'application/json';
  const res = await fetch(`/api${path}`, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(err.error || 'Request failed');
  }
  return res.json();
}

function logout() {
  state = { token: null, user: null };
  localStorage.removeItem('evv_token');
  localStorage.removeItem('evv_user');
  render();
}

function render() {
  if (!state.token) return renderLogin();
  userInfo.innerHTML = `${state.user.name} (${state.user.role}) &nbsp; <button class="secondary" id="logoutBtn">Log out</button>`;
  document.getElementById('logoutBtn').onclick = logout;
  if (state.user.role === 'admin') renderAdmin();
  else renderCaregiver();
}

// ---------- Login ----------
function renderLogin() {
  userInfo.innerHTML = '';
  app.innerHTML = `
    <div class="card login-box">
      <h2>Log in</h2>
      <form id="loginForm">
        <label>Email</label>
        <input type="email" id="email" value="admin@sunrise.com" required>
        <label>Password</label>
        <input type="password" id="password" value="admin123" required>
        <button type="submit">Log in</button>
        <div class="error" id="loginError"></div>
      </form>
      <p style="font-size:12px;color:#666">
        Try: admin@sunrise.com / admin123 (admin)<br>
        or jordan@sunrise.com / caregiver123 (caregiver)
      </p>
    </div>
  `;
  document.getElementById('loginForm').onsubmit = async (e) => {
    e.preventDefault();
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    try {
      const data = await api('/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('evv_token', state.token);
      localStorage.setItem('evv_user', JSON.stringify(state.user));
      render();
    } catch (err) {
      document.getElementById('loginError').textContent = err.message;
    }
  };
}

// ---------- Admin dashboard ----------
let adminTab = 'schedule';

async function renderAdmin() {
  app.innerHTML = `
    <div class="tabs">
      ${tabButton('schedule', 'Schedule & Exceptions')}
      ${tabButton('newvisit', 'New Visit')}
      ${tabButton('clients', 'Clients')}
      ${tabButton('caregivers', 'Caregivers')}
      ${tabButton('payroll', 'Payroll Export')}
    </div>
    <div id="tabContent"><div class="card"><p>Loading...</p></div></div>
  `;
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.onclick = () => { adminTab = btn.dataset.tab; renderAdmin(); };
  });
  await renderAdminTab();
}

function tabButton(key, label) {
  const active = adminTab === key ? 'active' : '';
  return `<button class="tab-btn ${active}" data-tab="${key}">${label}</button>`;
}

async function renderAdminTab() {
  const content = document.getElementById('tabContent');
  if (adminTab === 'schedule') return renderScheduleTab(content);
  if (adminTab === 'newvisit') return renderNewVisitTab(content);
  if (adminTab === 'clients') return renderClientsTab(content);
  if (adminTab === 'caregivers') return renderCaregiversTab(content);
  if (adminTab === 'payroll') return renderPayrollTab(content);
}

async function renderScheduleTab(content) {
  const [{ visits }, { exceptions }] = await Promise.all([
    api('/visits'),
    api('/exceptions'),
  ]);

  const exceptionRows = exceptions.map(e => `
    <tr>
      <td>${e.client_name}</td>
      <td>${e.caregiver_name}</td>
      <td>${formatTime(e.scheduled_start)}</td>
      <td>${e.exception_flags.split(',').map(f => `<span class="flag">${f.replace('_',' ')}</span>`).join('')}</td>
    </tr>`).join('');

  const visitRows = visits.map(v => `
    <tr>
      <td>${formatTime(v.scheduled_start)} - ${formatTime(v.scheduled_end)}</td>
      <td>${v.client_name}</td>
      <td>${v.caregiver_name}</td>
      <td><span class="status ${v.status}">${v.status.replace('_',' ')}</span></td>
      <td>${v.check_in_time ? formatTime(v.check_in_time) : '-'}</td>
      <td>${v.check_out_time ? formatTime(v.check_out_time) : '-'}</td>
      <td>${(v.exception_flags || '').split(',').filter(Boolean).map(f => `<span class="flag">${f.replace('_',' ')}</span>`).join('')}</td>
    </tr>`).join('');

  content.innerHTML = `
    <div class="card">
      <h2>Schedule</h2>
      <table>
        <tr><th>Time</th><th>Client</th><th>Caregiver</th><th>Status</th><th>Checked in</th><th>Checked out</th><th>Flags</th></tr>
        ${visitRows || '<tr><td colspan="7">No visits scheduled.</td></tr>'}
      </table>
    </div>
    <div class="card">
      <h2>Exceptions</h2>
      <table>
        <tr><th>Client</th><th>Caregiver</th><th>Scheduled</th><th>Flags</th></tr>
        ${exceptionRows || '<tr><td colspan="4">No exceptions. ✅</td></tr>'}
      </table>
    </div>
  `;
}

async function renderNewVisitTab(content) {
  const [{ clients }, { caregivers }] = await Promise.all([api('/clients'), api('/caregivers')]);
  const today = new Date().toISOString().slice(0, 10);

  content.innerHTML = `
    <div class="card">
      <h2>Schedule a New Visit</h2>
      <form id="visitForm">
        <label>Client</label>
        <select id="clientId" required>
          ${clients.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
        </select>
        <label>Caregiver</label>
        <select id="caregiverId" required>
          ${caregivers.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
        </select>
        <label>Date</label>
        <input type="date" id="visitDate" value="${today}" required>
        <label>Start time</label>
        <input type="time" id="startTime" value="09:00" required>
        <label>End time</label>
        <input type="time" id="endTime" value="10:00" required>
        <button type="submit">Create Visit</button>
        <div class="error" id="visitMsg"></div>
      </form>
    </div>
  `;

  if (clients.length === 0 || caregivers.length === 0) {
    document.getElementById('visitMsg').textContent =
      'Add at least one client and one caregiver before scheduling a visit.';
  }

  document.getElementById('visitForm').onsubmit = async (e) => {
    e.preventDefault();
    const date = document.getElementById('visitDate').value;
    const start = document.getElementById('startTime').value;
    const end = document.getElementById('endTime').value;
    try {
      await api('/visits', {
        method: 'POST',
        body: JSON.stringify({
          client_id: Number(document.getElementById('clientId').value),
          caregiver_id: Number(document.getElementById('caregiverId').value),
          scheduled_start: `${date}T${start}:00`,
          scheduled_end: `${date}T${end}:00`,
        }),
      });
      adminTab = 'schedule';
      renderAdmin();
    } catch (err) {
      document.getElementById('visitMsg').textContent = err.message;
    }
  };
}

async function renderClientsTab(content) {
  const { clients } = await api('/clients');
  const rows = clients.map(c => `
    <tr>
      <td>${c.name}</td>
      <td>${c.address || '-'}</td>
      <td>${c.payer_type}</td>
      <td>${c.lat ?? '-'}, ${c.lng ?? '-'}</td>
    </tr>`).join('');

  content.innerHTML = `
    <div class="card">
      <h2>Add Client</h2>
      <form id="clientForm">
        <label>Name</label>
        <input type="text" id="cName" required>
        <label>Address</label>
        <input type="text" id="cAddress">
        <label>Latitude (optional)</label>
        <input type="number" step="any" id="cLat">
        <label>Longitude (optional)</label>
        <input type="number" step="any" id="cLng">
        <button type="submit">Add Client</button>
        <div class="error" id="clientMsg"></div>
      </form>
    </div>
    <div class="card">
      <h2>Clients</h2>
      <table>
        <tr><th>Name</th><th>Address</th><th>Payer Type</th><th>Lat, Lng</th></tr>
        ${rows || '<tr><td colspan="4">No clients yet.</td></tr>'}
      </table>
    </div>
  `;

  document.getElementById('clientForm').onsubmit = async (e) => {
    e.preventDefault();
    const lat = document.getElementById('cLat').value;
    const lng = document.getElementById('cLng').value;
    try {
      await api('/clients', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('cName').value,
          address: document.getElementById('cAddress').value || null,
          lat: lat ? Number(lat) : null,
          lng: lng ? Number(lng) : null,
        }),
      });
      renderAdminTab();
    } catch (err) {
      document.getElementById('clientMsg').textContent = err.message;
    }
  };
}

async function renderCaregiversTab(content) {
  const { caregivers } = await api('/caregivers');
  const rows = caregivers.map(c => `
    <tr><td>${c.name}</td><td>${c.email}</td></tr>`).join('');

  content.innerHTML = `
    <div class="card">
      <h2>Add Caregiver</h2>
      <form id="caregiverForm">
        <label>Name</label>
        <input type="text" id="gName" required>
        <label>Email</label>
        <input type="email" id="gEmail" required>
        <label>Temporary Password</label>
        <input type="text" id="gPassword" required value="caregiver123">
        <button type="submit">Add Caregiver</button>
        <div class="error" id="caregiverMsg"></div>
      </form>
    </div>
    <div class="card">
      <h2>Caregivers</h2>
      <table>
        <tr><th>Name</th><th>Email</th></tr>
        ${rows || '<tr><td colspan="2">No caregivers yet.</td></tr>'}
      </table>
    </div>
  `;

  document.getElementById('caregiverForm').onsubmit = async (e) => {
    e.preventDefault();
    try {
      await api('/caregivers', {
        method: 'POST',
        body: JSON.stringify({
          name: document.getElementById('gName').value,
          email: document.getElementById('gEmail').value,
          password: document.getElementById('gPassword').value,
        }),
      });
      renderAdminTab();
    } catch (err) {
      document.getElementById('caregiverMsg').textContent = err.message;
    }
  };
}

async function renderPayrollTab(content) {
  const today = new Date().toISOString().slice(0, 10);
  content.innerHTML = `
    <div class="card">
      <h2>Payroll Export</h2>
      <p>Export completed visits (with hours worked) as a CSV for payroll processing.</p>
      <label>Start date</label>
      <input type="date" id="payStart" value="${today}">
      <label>End date</label>
      <input type="date" id="payEnd" value="${today}">
      <button id="exportBtn">Download CSV</button>
      <div class="error" id="payrollMsg"></div>
    </div>
  `;

  document.getElementById('exportBtn').onclick = async () => {
    const start = document.getElementById('payStart').value;
    const end = document.getElementById('payEnd').value;
    try {
      const res = await fetch(`/api/payroll/export?start=${start}&end=${end}`, {
        headers: { Authorization: `Bearer ${state.token}` },
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'payroll_export.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      document.getElementById('payrollMsg').textContent = err.message;
    }
  };
}

// ---------- Caregiver view ----------
async function renderCaregiver() {
  app.innerHTML = `<div class="card"><p>Loading...</p></div>`;
  const { visits } = await api('/visits');

  const rows = visits.map(v => {
    let actions = '';
    if (v.status === 'scheduled') {
      actions = `<button onclick="doCheckin(${v.id})">Check in</button>`;
    } else if (v.status === 'in_progress') {
      actions = `<button onclick="doCheckout(${v.id})">Check out</button>`;
    } else {
      actions = '<em>Done</em>';
    }
    return `
      <div class="card">
        <strong>${v.client_name}</strong><br>
        ${v.client_address}<br>
        ${formatTime(v.scheduled_start)} - ${formatTime(v.scheduled_end)}
        <span class="status ${v.status}">${v.status.replace('_',' ')}</span>
        <div class="visit-actions" style="margin-top:10px">${actions}</div>
        <div id="msg-${v.id}" class="error"></div>
      </div>`;
  }).join('');

  app.innerHTML = `<h2 style="padding:0 4px">My Visits Today</h2>` + (rows || '<div class="card">No visits scheduled.</div>');
}

function getLocation() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve({ lat: null, lng: null });
    navigator.geolocation.getCurrentPosition(
      pos => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      () => resolve({ lat: null, lng: null }),
      { timeout: 5000 }
    );
  });
}

window.doCheckin = async (visitId) => {
  const loc = await getLocation();
  try {
    await api(`/visits/${visitId}/checkin`, { method: 'POST', body: JSON.stringify(loc) });
    renderCaregiver();
  } catch (err) {
    document.getElementById(`msg-${visitId}`).textContent = err.message;
  }
};

window.doCheckout = async (visitId) => {
  const loc = await getLocation();
  try {
    await api(`/visits/${visitId}/checkout`, { method: 'POST', body: JSON.stringify(loc) });
    renderCaregiver();
  } catch (err) {
    document.getElementById(`msg-${visitId}`).textContent = err.message;
  }
};

function formatTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

render();
