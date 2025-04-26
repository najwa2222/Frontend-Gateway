// frontend‑service/app.js
require('dotenv').config();
const express       = require('express');
const helmet        = require('helmet');
const session       = require('express-session');
const flash         = require('connect-flash');
const bodyParser    = require('body-parser');
const path          = require('path');
const exphbs        = require('express-handlebars');
const axios         = require('axios');
const moment        = require('moment');
moment.locale('ar');

const app = express();
const API = process.env.API_URL;
/**
 * Fetch a paginated resource from your API and
 * return { rows, page, totalPages, searchTerm }.
 */
async function fetchPaginated(req, path) {
  const page  = parseInt(req.query.page)  || 1;
  const search = req.query.search || '';
  const { data } = await axios.get(`${API}${path}`, {
    params: { page, search },
    ...apiHeader(req)           // <-- spread your JWT header correctly
  });
  return data;                  // { rows, page, totalPages, searchTerm }
}


// — Security & Static —
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'", 'cdnjs.cloudflare.com','cdn.jsdelivr.net'],
      styleSrc:   ["'self'", 'fonts.googleapis.com','cdn.jsdelivr.net','cdnjs.cloudflare.com',"'unsafe-inline'"],
      fontSrc:    ["'self'", 'fonts.gstatic.com','cdnjs.cloudflare.com'],
      imgSrc:     ["'self'", 'data:']
    }
  }
}));
app.use('/css', express.static(path.join(__dirname, 'node_modules/bootstrap/dist/css')));
app.use('/js',  express.static(path.join(__dirname, 'node_modules/bootstrap/dist/js')));
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

// — Sessions & Flash —
app.use(session({
  secret: process.env.SESSION_SECRET || 'keyboard cat',
  resave: true,
  saveUninitialized: false,
  cookie: {
    secure: false,
    maxAge: 3600000
  }
}));
app.use(flash());

// — Handlebars & Helpers —
const hbs = exphbs.create({
  extname: '.hbs',
  defaultLayout: 'main',
  helpers: {
    eq: (a, b) => a == b,
    range: (start, end) => {
      const result = [];
      for (let i = start; i <= end; i++) result.push(i);
      return result;
    },
    formatDate: d => d ? moment(d).format('YYYY-MM-DD HH:mm') : '',
    getBadgeClass: (status) => {
      switch (status) {
        case 'pending': return 'warning';
        case 'reviewed': return 'info';
        case 'resolved': return 'success';
        default: return 'secondary';
      }
    },
    arStatus: (status) => {
      const map = {
        pending: 'قيد الانتظار',
        reviewed: 'قيد المراجعة',
        resolved: 'تم الحل'
      };
      return map[status] || status;
    },
    json: obj => JSON.stringify(obj, null, 2) // for debugging
  }
});

app.engine('hbs', hbs.engine);
app.set('view engine', 'hbs');
app.set('views', path.join(__dirname, 'views'));

// — Helper to add JWT header when calling API —
function apiHeader(req) {
  return { headers: { Authorization: `Bearer ${req.session.token}` } };
}

app.use((req, res, next) => {
  res.locals.session = req.session;
  res.locals.flash = {
    success: req.flash('success'),
    error: req.flash('error')
  };
  next();
});

// — Routes —

// Home
app.get('/', (req,res)=>res.render('home'));

// Farmer → register
app.get('/farmer/register', (req,res)=>res.render('farmer_register'));

app.post('/farmer/register', async (req,res)=>{
  try {
    await axios.post(`${API}/farmer/register`, req.body);
    req.flash('success','تم التسجيل بنجاح');
    res.redirect('/farmer/login');
  } catch(e) {
    console.error('Registration error:', e.response?.data || e.message);
    req.flash('error', e.response?.data?.message || 'خطأ في التسجيل');
    res.redirect('/farmer/register');
  }
});

// Farmer → login
app.get('/farmer/login', (req,res)=>res.render('farmer_login'));
app.post('/farmer/login', async (req,res)=>{
  console.log('▶️  [farmer/login] got body:', req.body);
  try {
    const { data } = await axios.post(`${API}/farmer/login`, req.body);
    req.session.token = data.token;
    req.session.farmerId = data.farmer.id;
    req.session.user = data.farmer;
    res.redirect('/farmer/dashboard');
  } catch (e) {
    console.error('Login error:', e.response?.data || e.message);
    req.flash('error', e.response?.data?.message || 'بيانات غير صحيحة');
    res.redirect('/farmer/login');
  }
});

// Forgot password
app.get('/farmer/forgot-password',(req,res)=>res.render('forgot_password'));
app.post('/farmer/forgot-password', async (req,res)=>{
  try {
    const { data } = await axios.post(`${API}/farmer/forgot-password`, req.body);
    // store reset_token in session for next step
    req.session.reset_token = data.reset_token;
    req.session.national_id = req.body.national_id;
    res.redirect('/farmer/verify-code');
  } catch {
    req.flash('error','لم يتم العثور على مزارع بهذه البيانات');
    res.redirect('/farmer/forgot-password');
  }
});

// Verify code
app.get('/farmer/verify-code',(req,res)=> {
  res.render('verify_code',{ national_id: req.session.national_id });
});
app.post('/farmer/verify-code', async (req,res)=>{
  try {
    const code = req.body.code1+req.body.code2+req.body.code3+req.body.code4+req.body.code5+req.body.code6;
    await axios.post(`${API}/farmer/verify-code`, {
      national_id: req.session.national_id,
      verification_code: code
    });
    res.redirect('/farmer/reset-password');
  } catch {
    req.flash('error','رمز التحقق غير صحيح أو منتهي الصلاحية');
    res.redirect('/farmer/verify-code');
  }
});

// Reset password
app.get('/farmer/reset-password',(req,res)=> {
  res.render('reset_password',{ national_id: req.session.national_id, reset_token: req.session.reset_token });
});
app.post('/farmer/reset-password', async (req,res)=>{
  try {
    await axios.post(`${API}/farmer/reset-password`, {
      national_id: req.body.national_id,
      reset_token: req.body.reset_token,
      password: req.body.password
    });
    req.flash('success','تم تغيير كلمة المرور بنجاح');
    res.redirect('/farmer/login');
  } catch {
    req.flash('error','حدث خطأ في إعادة التعيين');
    res.redirect('/farmer/reset-password');
  }
});

// Farmer dashboard & new objection
app.get('/farmer/dashboard', async (req,res)=>{
  if (!req.session.token) return res.redirect('/farmer/login');
  try {
    const { data: objections } = await axios.get(`${API}/objection`, apiHeader(req));
    const { data: eligibility } = await axios.get(`${API}/objection/can-submit`, apiHeader(req));
    res.render('farmer_dashboard',{ objections, canSubmitNewObjection: eligibility.canSubmit });
  } catch {
    req.flash('error','خطأ في تحميل البيانات');
    res.redirect('/');
  }
});
app.get('/objection/new', (req,res)=>{
  if (!req.session.token) return res.redirect('/farmer/login');
  res.render('objection_new');
});
app.post('/objection/new', async (req,res)=>{
  try {
    await axios.post(`${API}/objection`, req.body, apiHeader(req));
    req.flash('success','تم تقديم الاعتراض بنجاح');
    res.redirect('/farmer/dashboard');
  } catch {
    req.flash('error','خطأ في تقديم الاعتراض');
    res.redirect('/objection/new');
  }
});

// Admin login & dashboard
app.get('/admin/login',(req,res)=>res.render('admin_login'));

app.post('/admin/login', async (req,res)=>{
  console.log('▶️  [admin/login] got body:', req.body);
  try {
    const { data } = await axios.post(`${API}/admin/login`, req.body);
    if (data && data.token) {
      req.session.token = data.token;
      req.session.admin = true;
      res.redirect('/admin/dashboard');
    } else {
      req.flash('error','بيانات غير كاملة');
      res.redirect('/admin/login');
    }
  } catch (e) {
    req.flash('error', e.response?.data?.message || 'بيانات الدخول غير صحيحة');
    res.redirect('/admin/login');
  }
});

// Admin dashboard (pending+reviewed)
app.get('/admin/dashboard', async (req, res) => {
  if (!req.session.admin) return res.redirect('/admin/login');
  try {
    const { rows, page, totalPages, searchTerm } = 
        await fetchPaginated(req, '/admin/objections');
    res.render('admin_dashboard', { rows, page, totalPages, searchTerm });
  } catch (e) {
    console.error('❌ /admin/dashboard error:', 
    e.response?.status, e.response?.data, e.message);
    req.flash('error','خطأ في تحميل البيانات');
    res.redirect('/admin/login');
  }
});

// Admin archive (resolved)
app.get('/admin/archive', async (req, res) => {
  if (!req.session.admin) return res.redirect('/admin/login');
  try {
    const { rows, page, totalPages, searchTerm } = 
        await fetchPaginated(req, '/admin/archive');
    res.render('admin_archive', { rows, page, totalPages, searchTerm });
  } catch (e) {
    req.flash('error', 'خطأ في تحميل بيانات الأرشيف');
    res.redirect('/admin/dashboard');
  }
});

// Admin review / resolve
app.post('/admin/objection/:id/review', async (req,res)=>{
  await axios.post(`${API}/admin/objection/${req.params.id}/review`,{}, apiHeader(req));
  res.redirect('/admin/dashboard');
});
app.post('/admin/objection/:id/resolve', async (req,res)=>{
  await axios.post(`${API}/admin/objection/${req.params.id}/resolve`,{}, apiHeader(req));
  res.redirect('/admin/dashboard');
});

// Logout routes
app.get('/farmer/logout',(req,res)=> req.session.destroy(()=>res.redirect('/')));
app.get('/admin/logout',(req,res)=>  req.session.destroy(()=>res.redirect('/')));


// Debug route proxy
app.get('/debug/env', async (req,res)=>{
  try {
    const { data } = await axios.get(`${API}/debug/env`);
    res.json(data);
  } catch {
    res.status(404).send('Not available');
  }
});

app.get('/crash', (req, res) => {
  throw new Error('Test crash!');
});

app.get('/livez', (req, res) => res.status(200).send('Frontend is up'));

// 404 & error handlers
app.use((req,res)=>res.status(404).render('error',{ status:404,message:'الصفحة غير موجودة',layout:false }));
app.use((err,req,res,next)=>{
  console.error(err);
  res.status(500).render('error',{ status:500,message:'حدث خطأ غير متوقع',layout:false });
});

// — Start —
app.listen(process.env.PORT||3000, ()=> console.log('🌐 Frontend up on port', process.env.PORT||3000));
