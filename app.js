require('dotenv').config();
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const flash = require('connect-flash');
const bodyParser = require('body-parser');
const path = require('path');
const exphbs = require('express-handlebars');
const axios = require('axios');
const moment = require('moment');

moment.locale('ar');
const app = express();

const PORT = process.env.PORT;
const CRDA_API = process.env.CRDA_API_URL;
const OBJECTION_API = process.env.OBJECTION_API_URL;

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'cdnjs.cloudflare.com', 'cdn.jsdelivr.net'],
      styleSrc: ["'self'", 'fonts.googleapis.com', 'cdn.jsdelivr.net', 'cdnjs.cloudflare.com', "'unsafe-inline'"],
      fontSrc: ["'self'", 'fonts.gstatic.com', 'cdnjs.cloudflare.com'],
      imgSrc: ["'self'", 'data:']
    }
  }
}));

app.use('/css', express.static(path.join(__dirname, 'node_modules/bootstrap/dist/css')));
app.use('/js', express.static(path.join(__dirname, 'node_modules/bootstrap/dist/js')));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: true,
  saveUninitialized: false,
  cookie: { secure: false, maxAge: 3600000 }
}));
app.use(flash());

app.use((req, res, next) => {
  if (req.path.startsWith('/crda')) {
    res.locals.layout = 'crda_main';
  } else if (req.path.startsWith('/objection')) {
    res.locals.layout = 'objection_main';
  } else {
    res.locals.layout = 'main';
  }
  next();
});

app.engine('.hbs', exphbs.create({
  extname: '.hbs',
  layoutsDir: path.join(__dirname, 'views', 'layouts'),
  defaultLayout: false,
  helpers: {
    eq: (a, b) => a == b,
    range: (start, end) => {
      const result = [];
      for (let i = start; i <= end; i++) result.push(i);
      return result;
    },
    formatDate: d => d ? moment(d).format('YYYY-MM-DD HH:mm') : '',
    getBadgeClass: status => {
      switch (status) {
        case 'pending': return 'warning';
        case 'reviewed': return 'info';
        case 'resolved': return 'success';
        default: return 'secondary';
      }
    },
    arStatus: status => ({
      pending: 'قيد الانتظار',
      reviewed: 'قيد المراجعة',
      resolved: 'تم الحل'
    }[status] || status),
    json: obj => JSON.stringify(obj, null, 2)
  }
}).engine);
app.set('view engine', '.hbs');
app.set('views', path.join(__dirname, 'views'));

const crdaClient = axios.create({ baseURL: CRDA_API, withCredentials: true });
const objectionClient = axios.create({ baseURL: OBJECTION_API, withCredentials: true });

crdaClient.interceptors.response.use(
  response => response,
  error => {
    console.error('API Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    return Promise.reject(error);
  }
);

objectionClient.interceptors.response.use(
  response => response,
  error => {
    console.error('API Error:', error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response data:', error.response.data);
    }
    return Promise.reject(error);
  }
);

app.use((req, res, next) => {
  // Make session data available to all views
  res.locals.session = req.session;
  
  // Explicitly set login status flags to make template conditions easier
  res.locals.isLoggedIn = !!req.session.token;
  res.locals.isAdmin = !!req.session.admin;
  res.locals.isFarmer = !!req.session.token && !!req.session.user && !req.session.admin;
  
  // Pass the user object directly for easy access
  res.locals.user = req.session.user;
  
  // Make flash messages available to templates
  res.locals.flash = {
    success: req.flash('success'),
    error: req.flash('error')
  };
  
  next();
});

async function fetchPaginated(req, path, client) {
  const page = parseInt(req.query.page) || 1;
  const search = (req.query.search || '').trim();
  
  // Create config with params
  const config = { 
    params: { page, search } 
  };
  
  // Add auth token if available in session
  if (req.session.token) {
    config.headers = {
      Authorization: `Bearer ${req.session.token}`
    };
  }
  
  // Make the request with proper error handling
  try {
    const { data } = await client.get(path, config);
    return data;
  } catch (error) {
    console.error(`Error fetching paginated data from ${path}:`, error.message);
    // Re-throw to be handled by the route handler
    throw error;
  }
}

app.get('/', (req, res) => res.redirect('/crda'));

// Objection UI
app.get('/objection', (req, res) => res.render('objection/home'));
app.get('/objection/farmer/register', (req, res) => res.render('objection/farmer_register'));
app.post('/objection/farmer/register', async (req, res) => {
  try {
    await objectionClient.post('/farmer/register', req.body);
    req.flash('success', 'تم التسجيل بنجاح');
    res.redirect('/objection/farmer/login');
  } catch {
    req.flash('error', 'خطأ في التسجيل');
    res.redirect('/objection/farmer/register');
  }
});
app.get('/objection/farmer/login', (req, res) => res.render('objection/farmer_login'));
app.post('/objection/farmer/login', async (req, res) => {
  try {
    const { data } = await objectionClient.post('/farmer/login', req.body);
    
    // Store token and user data in session
    req.session.token = data.token;
    req.session.user = data.farmer;
    
    // Explicitly set farmer flag (and ensure admin is not set)
    req.session.admin = false;
    
    // Redirect to dashboard
    res.redirect('/objection/farmer/dashboard');
  } catch (error) {
    console.error("Login error:", error.message);
    req.flash('error', 'بيانات غير صحيحة');
    res.redirect('/objection/farmer/login');
  }
});
app.get('/objection/farmer/forgot-password', (req, res) => res.render('objection/forgot_password'));
app.post('/objection/farmer/forgot-password', async (req, res) => {
  try {
    const { data } = await objectionClient.post('/farmer/forgot-password', req.body);
    req.session.reset_token = data.reset_token;
    req.session.national_id = req.body.national_id;
    res.redirect('/objection/farmer/verify-code');
  } catch {
    req.flash('error', 'لم يتم العثور على مزارع بهذه البيانات');
    res.redirect('/objection/farmer/forgot-password');
  }
});
app.get('/objection/farmer/verify-code', (req, res) => res.render('objection/verify_code', { national_id: req.session.national_id }));
app.post('/objection/farmer/verify-code', async (req, res) => {
  try {
    const code = [req.body.code1, req.body.code2, req.body.code3, req.body.code4, req.body.code5, req.body.code6].join('');
    await objectionClient.post('/farmer/verify-code', { national_id: req.session.national_id, verification_code: code });
    res.redirect('/objection/farmer/reset-password');
  } catch {
    req.flash('error', 'رمز التحقق غير صحيح أو منتهي الصلاحية');
    res.redirect('/objection/farmer/verify-code');
  }
});
app.get('/objection/farmer/reset-password', (req, res) => res.render('objection/reset_password', { national_id: req.session.national_id, reset_token: req.session.reset_token }));
app.post('/objection/farmer/reset-password', async (req, res) => {
  try {
    await objectionClient.post('/farmer/reset-password', { national_id: req.body.national_id, reset_token: req.body.reset_token, password: req.body.password });
    req.flash('success', 'تم تغيير كلمة المرور بنجاح');
    res.redirect('/objection/farmer/login');
  } catch {
    req.flash('error', 'حدث خطأ في إعادة التعيين');
    res.redirect('/objection/farmer/reset-password');
  }
});
app.get('/objection/farmer/dashboard', async (req, res) => {
  if (!req.session.token) return res.redirect('/objection/farmer/login');
  try {
    // Get objection data with proper error handling
    const objResponse = await objectionClient.get('/objection', { 
      headers: { Authorization: `Bearer ${req.session.token}` }
    });
    
    // Get eligibility with proper error handling
    const eligResponse = await objectionClient.get('/objection/can-submit', { 
      headers: { Authorization: `Bearer ${req.session.token}` }
    });
    
    res.render('objection/farmer_dashboard', { 
      objections: objResponse.data, 
      canSubmitNewObjection: eligResponse.data.canSubmit,
      user: req.session.user
    });
  } catch (error) {
    // More detailed error handling
    console.error("Dashboard error:", error.message);
    req.flash('error', 'خطأ في تحميل البيانات - الرجاء المحاولة مرة أخرى');
    res.redirect('/objection');
  }
});
app.get('/objection/objection/new', (req, res) => { if (!req.session.token) return res.redirect('/objection/farmer/login'); res.render('objection/objection_new'); });
app.post('/objection/objection/new', async (req, res) => {
  try {
    await objectionClient.post('/objection', req.body, { headers: { Authorization: `Bearer ${req.session.token}` } });
    req.flash('success', 'تم تقديم الاعتراض بنجاح');
    res.redirect('/objection/farmer/dashboard');
  } catch {
    req.flash('error', 'خطأ في تقديم الاعتراض');
    res.redirect('/objection/objection/new');
  }
});
app.get('/objection/admin/login', (req, res) => res.render('objection/admin_login'));

app.post('/objection/admin/login', async (req, res) => {
  try {
    const { data } = await objectionClient.post('/admin/login', req.body);
    req.session.token = data.token;
    req.session.admin = true;
    req.session.user = { admin: true }; // Add this to maintain consistent session structure
    res.redirect('/objection/admin/dashboard');
  } catch (error) {
    console.error("Admin login error:", error.message);
    req.flash('error', 'بيانات الدخول غير صحيحة');
    res.redirect('/objection/admin/login');
  }
});

app.get('/objection/admin/dashboard', async (req, res) => {
  if (!req.session.admin) return res.redirect('/objection/admin/login');
  try {
    // Use improved fetchPaginated which now includes auth headers
    const data = await fetchPaginated(req, '/admin/objections', objectionClient);
    
    res.render('objection/admin_dashboard', {
      rows: data.rows,
      page: data.page,
      totalPages: data.totalPages,
      searchTerm: data.searchTerm,
      admin: true  // Explicitly mark as admin view
    });
  } catch (error) {
    console.error('Admin dashboard load error:', error.message);
    
    // Check if it's an auth error
    if (error.response && error.response.status === 401) {
      req.flash('error', 'انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول');
      req.session.destroy(() => res.redirect('/objection/admin/login'));
    } else {
      req.flash('error', 'خطأ في تحميل البيانات: ' + (error.response?.data?.message || 'حاول مرة أخرى'));
      res.redirect('/objection/admin/login');
    }
  }
});

app.get('/objection/admin/archive', async (req, res) => {
  if (!req.session.admin) return res.redirect('/objection/admin/login');
  try {
    // Use improved fetchPaginated function
    const data = await fetchPaginated(req, '/admin/archive', objectionClient);
    
    res.render('objection/admin_archive', {
      rows: data.rows,
      page: data.page,
      totalPages: data.totalPages,
      searchTerm: data.searchTerm,
      admin: true  // Explicitly mark as admin view
    });
  } catch (error) {
    console.error('Admin archive load error:', error.message);
    
    // Check if it's an auth error
    if (error.response && error.response.status === 401) {
      req.flash('error', 'انتهت صلاحية الجلسة، يرجى إعادة تسجيل الدخول');
      req.session.destroy(() => res.redirect('/objection/admin/login'));
    } else {
      req.flash('error', 'خطأ في تحميل الأرشيف: ' + (error.response?.data?.message || 'حاول مرة أخرى'));
      res.redirect('/objection/admin/dashboard');
    }
  }
});

app.post('/objection/admin/objection/:id/review', async (req, res) => { await objectionClient.post(`/admin/objection/${req.params.id}/review`, {}, { headers: { Authorization: `Bearer ${req.session.token}` } }); res.redirect('/objection/admin/dashboard'); });
app.post('/objection/admin/objection/:id/resolve', async (req, res) => { await objectionClient.post(`/admin/objection/${req.params.id}/resolve`, {}, { headers: { Authorization: `Bearer ${req.session.token}` } }); res.redirect('/objection/admin/dashboard'); });
app.get('/objection/farmer/logout', (req, res) => req.session.destroy(() => res.redirect('/objection')));
app.get('/objection/admin/logout', (req, res) => req.session.destroy(() => res.redirect('/objection/admin/login')));

// CRDA UI
app.get('/crda', (req, res) => res.render('crda/index', { user: req.session.user }));
app.get('/crda/about', (req, res) => res.render('crda/about', { user: req.session.user }));
app.get('/crda/check-status', (req, res) => res.render('crda/check-status', { user: req.session.user }));
app.get('/crda/login', (req, res) => res.render('crda/login', { error: req.query.error, success: req.query.success }));
app.post('/crda/login', async (req, res) => { try { const { data } = await crdaClient.post('/login', req.body, { withCredentials: true }); req.session.user = data.user; res.redirect('/crda/services'); } catch { res.redirect('/crda/login?error=invalid_credentials'); } });
app.get('/crda/logout', (req, res) => req.session.destroy(() => res.redirect('/crda/login')));
app.get('/crda/register', (req, res) => res.render('crda/register', { error: req.query.error, success: req.query.success }));
app.post('/crda/register', async (req, res) => { try { await crdaClient.post('/register', req.body); res.redirect('/crda/pending_approval'); } catch { res.redirect('/crda/register?error=registration_failed'); } });
app.get('/crda/pending_approval', (req, res) => res.render('crda/pending_approval'));
app.get('/crda/unapproved_login', (req, res) => res.render('crda/unapproved_login'));
app.get('/crda/services', async (req, res) => { if (!req.session.user) return res.redirect('/crda/login'); try { const { data } = await crdaClient.get('/services', { withCredentials: true }); res.render('crda/services', { services: data.services }); } catch { res.redirect('/crda/login'); } });
app.get('/crda/getservices', async (req, res) => { if (!req.session.user) return res.redirect('/crda/login'); try { const { rows } = await fetchPaginated(req, '/services', crdaClient); res.render('crda/afficher', { services: rows }); } catch { res.redirect('/crda/services'); } });
app.get('/crda/editservice/:id', async (req, res) => { if (!req.session.user) return res.redirect('/crda/login'); try { const { data } = await crdaClient.get(`/services/${req.params.id}`, { withCredentials: true }); res.render('crda/editservice', { service: data }); } catch { res.redirect('/crda/getservices'); } });
app.post('/crda/addservice', async (req, res) => { try { await crdaClient.post('/services', req.body, { withCredentials: true }); res.redirect('/crda/getservices'); } catch { res.redirect('/crda/services'); } });
app.post('/crda/updateservice/:id', async (req, res) => { try { await crdaClient.put(`/services/${req.params.id}`, req.body, { withCredentials: true }); res.redirect('/crda/getservices'); } catch { res.redirect(`/crda/editservice/${req.params.id}`); } });
app.get('/crda/report', (req, res) => { if (!req.session.user) return res.redirect('/crda/login'); res.render('crda/report', { isViewing: false }); });
app.get('/crda/viewreport', async (req, res) => { if (!req.session.user) return res.redirect('/crda/login'); try { const { data } = await crdaClient.get(`/reports?cin=${req.query.cin}&sujet=${req.query.sujet}`, { withCredentials: true }); res.render('crda/report', { isViewing: true, report: data.report }); } catch { res.redirect('/crda/getreports'); } });
app.get('/crda/getreports', async (req, res) => { if (!req.session.user) return res.redirect('/crda/login'); try { const { rows } = await fetchPaginated(req, '/reports', crdaClient); res.render('crda/getreports', { services: rows }); } catch { res.redirect('/crda/services'); } });
app.post('/crda/addreport', async (req, res) => { try { await crdaClient.post('/reports', req.body, { withCredentials: true }); res.redirect('/crda/getreports'); } catch { res.redirect('/crda/report'); } });
app.post('/crda/updatereport/:id', async (req, res) => { try { await crdaClient.put(`/reports/${req.params.id}`, req.body, { withCredentials: true }); res.redirect('/crda/getreports'); } catch { res.redirect(`/crda/editreport/${req.params.id}`); } });
app.get('/crda/results', async (req, res) => { if (!req.session.user) return res.redirect('/crda/login'); try { const { data } = await crdaClient.get('/results', { withCredentials: true }); res.render('crda/results', { services: data.results }); } catch { res.redirect('/crda/getreports'); } });
app.get('/crda/editresult/:id', async (req, res) => { if (!req.session.user) return res.redirect('/crda/login'); try { const { data } = await crdaClient.get(`/results?cin=${req.query.cin}&sujet=${req.query.sujet}`, { withCredentials: true }); const svc = data.results[0]; res.render('crda/editresult', { service: svc, result: svc.statut }); } catch { res.redirect('/crda/results'); } });
app.post('/crda/updateresult', async (req, res) => { try { await crdaClient.post('/results', req.body, { withCredentials: true }); res.redirect('/crda/results'); } catch { res.redirect(`/crda/editresult/${req.body.id}`); } });
app.get('/crda/admin/pending-accounts', async (req, res) => { if (!req.session.user) return res.redirect('/crda/login'); try { const { data } = await crdaClient.get('/admin/pending-accounts', { withCredentials: true }); res.render('crda/admin/pending-accounts', { accounts: data.accounts }); } catch { res.redirect('/crda/results'); } });
app.post('/crda/admin/approve-account/:id', async (req, res) => { await crdaClient.post(`/admin/approve-account/${req.params.id}`, {}, { withCredentials: true }); res.redirect('/crda/admin/pending-accounts'); });
app.post('/crda/admin/reject-account/:id', async (req, res) => { await crdaClient.post(`/admin/reject-account/${req.params.id}`, {}, { withCredentials: true }); res.redirect('/crda/admin/pending-accounts'); });

app.get('/livez', (req, res) => res.status(200).send('Frontend is up'));

app.use((req, res) => res.status(404).render('error', { status: 404, message: 'الصفحة غير موجودة', layout: false }));
app.use((err, req, res, next) => { console.error(err); res.status(500).render('error', { status: 500, message: 'حدث خطأ غير متوقع', layout: false }); });

app.listen(PORT, () => console.log(`Frontend UI listening on port ${PORT}`));
