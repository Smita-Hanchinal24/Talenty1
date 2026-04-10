const express = require('express');
const cors = require('cors');
const path = require('path');
const Database = require('better-sqlite3');

const app = express();
const PORT = 3000;

// ==================== MIDDLEWARE ====================
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname)));

// ==================== DATABASE SETUP ====================
const db = new Database(path.join(__dirname, 'talenty.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    company TEXT NOT NULL,
    location TEXT NOT NULL,
    salary TEXT NOT NULL,
    type TEXT NOT NULL CHECK(type IN ('Full-time','Part-time','Remote','Hybrid','Contract')),
    icon TEXT DEFAULT 'fas fa-briefcase',
    tags TEXT DEFAULT '[]',
    description TEXT DEFAULT '',
    is_active INTEGER DEFAULT 1,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS applications (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_id INTEGER NOT NULL,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    phone TEXT DEFAULT '',
    linkedin TEXT DEFAULT '',
    cover_letter TEXT DEFAULT '',
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','reviewed','shortlisted','rejected','hired')),
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (job_id) REFERENCES jobs(id)
  );

  CREATE TABLE IF NOT EXISTS contacts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    first_name TEXT NOT NULL,
    last_name TEXT NOT NULL,
    email TEXT NOT NULL,
    company TEXT DEFAULT '',
    message TEXT NOT NULL,
    is_read INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// ==================== SEED DEFAULT JOBS ====================
const jobCount = db.prepare('SELECT COUNT(*) as count FROM jobs').get();
if (jobCount.count === 0) {
  const insertJob = db.prepare(`
    INSERT INTO jobs (title, company, location, salary, type, icon, tags, description)
    VALUES (@title, @company, @location, @salary, @type, @icon, @tags, @description)
  `);

  const seedJobs = [
    { title: "Frontend Developer", company: "TechNova Corp", location: "New York, NY", salary: "$80K – $120K", type: "Full-time", icon: "fas fa-laptop-code", tags: '["React","TypeScript","TailwindCSS"]', description: "Build responsive, high-performance web interfaces using React and TypeScript. Collaborate with designers to implement pixel-perfect UIs." },
    { title: "Backend Engineer", company: "DataStream Inc", location: "San Francisco, CA", salary: "$100K – $150K", type: "Hybrid", icon: "fas fa-server", tags: '["Node.js","Python","PostgreSQL"]', description: "Design and build scalable backend services and RESTful APIs. Optimize database queries and ensure system reliability." },
    { title: "Data Analyst", company: "Insight Analytics", location: "Remote", salary: "$70K – $100K", type: "Remote", icon: "fas fa-chart-bar", tags: '["SQL","Python","Tableau"]', description: "Analyze large datasets to provide actionable business insights. Create dashboards and reports for stakeholder decision-making." },
    { title: "UI/UX Designer", company: "CreativeHub", location: "Austin, TX", salary: "$75K – $110K", type: "Full-time", icon: "fas fa-paint-brush", tags: '["Figma","Sketch","CSS"]', description: "Create intuitive, beautiful user experiences across web and mobile platforms. Conduct user research and usability testing." },
    { title: "DevOps Engineer", company: "CloudBase Ltd", location: "Remote", salary: "$110K – $160K", type: "Remote", icon: "fas fa-cloud", tags: '["AWS","Docker","Kubernetes"]', description: "Build and maintain CI/CD pipelines, manage cloud infrastructure, and ensure 99.99% uptime for production services." },
    { title: "Product Manager", company: "LaunchPad HQ", location: "Chicago, IL", salary: "$90K – $130K", type: "Hybrid", icon: "fas fa-project-diagram", tags: '["Agile","Roadmapping","JIRA"]', description: "Drive product strategy from ideation to launch. Prioritize features, coordinate cross-functional teams, and measure product success." },
  ];

  const insertMany = db.transaction((jobs) => {
    for (const job of jobs) insertJob.run(job);
  });
  insertMany(seedJobs);
  console.log('✅ Seeded 6 default jobs');
}

// ==================== API: JOBS ====================

// GET all active jobs
app.get('/api/jobs', (req, res) => {
  const { search, type } = req.query;
  let query = 'SELECT * FROM jobs WHERE is_active = 1';
  const params = [];

  if (search) {
    query += ' AND (title LIKE ? OR company LIKE ? OR location LIKE ? OR tags LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }
  if (type) {
    query += ' AND type = ?';
    params.push(type);
  }

  query += ' ORDER BY created_at DESC';
  const jobs = db.prepare(query).all(...params);
  jobs.forEach(j => j.tags = JSON.parse(j.tags));
  res.json({ success: true, data: jobs, count: jobs.length });
});

// GET single job
app.get('/api/jobs/:id', (req, res) => {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
  job.tags = JSON.parse(job.tags);
  res.json({ success: true, data: job });
});

// POST create job (admin)
app.post('/api/jobs', (req, res) => {
  const { title, company, location, salary, type, icon, tags, description } = req.body;
  if (!title || !company || !location || !salary || !type) {
    return res.status(400).json({ success: false, error: 'Missing required fields: title, company, location, salary, type' });
  }
  const result = db.prepare(`
    INSERT INTO jobs (title, company, location, salary, type, icon, tags, description)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(title, company, location, salary, type, icon || 'fas fa-briefcase', JSON.stringify(tags || []), description || '');

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(result.lastInsertRowid);
  job.tags = JSON.parse(job.tags);
  res.status(201).json({ success: true, data: job });
});

// PUT update job (admin)
app.put('/api/jobs/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'Job not found' });

  const { title, company, location, salary, type, icon, tags, description, is_active } = req.body;
  db.prepare(`
    UPDATE jobs SET title=?, company=?, location=?, salary=?, type=?, icon=?, tags=?, description=?, is_active=?
    WHERE id=?
  `).run(
    title || existing.title, company || existing.company, location || existing.location,
    salary || existing.salary, type || existing.type, icon || existing.icon,
    tags ? JSON.stringify(tags) : existing.tags, description ?? existing.description,
    is_active ?? existing.is_active, req.params.id
  );

  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  job.tags = JSON.parse(job.tags);
  res.json({ success: true, data: job });
});

// DELETE job (admin)
app.delete('/api/jobs/:id', (req, res) => {
  const existing = db.prepare('SELECT * FROM jobs WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'Job not found' });
  db.prepare('DELETE FROM applications WHERE job_id = ?').run(req.params.id);
  db.prepare('DELETE FROM jobs WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Job deleted' });
});

// ==================== API: APPLICATIONS ====================

// POST submit application
app.post('/api/applications', (req, res) => {
  const { job_id, first_name, last_name, email, phone, linkedin, cover_letter } = req.body;
  if (!job_id || !first_name || !last_name || !email) {
    return res.status(400).json({ success: false, error: 'Missing required fields: job_id, first_name, last_name, email' });
  }
  const job = db.prepare('SELECT * FROM jobs WHERE id = ? AND is_active = 1').get(job_id);
  if (!job) return res.status(404).json({ success: false, error: 'Job not found or no longer active' });

  const duplicate = db.prepare('SELECT id FROM applications WHERE job_id = ? AND email = ?').get(job_id, email);
  if (duplicate) return res.status(409).json({ success: false, error: 'You have already applied for this position' });

  const result = db.prepare(`
    INSERT INTO applications (job_id, first_name, last_name, email, phone, linkedin, cover_letter)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(job_id, first_name, last_name, email, phone || '', linkedin || '', cover_letter || '');

  res.status(201).json({ success: true, message: 'Application submitted successfully!', id: result.lastInsertRowid });
});

// GET all applications (admin)
app.get('/api/applications', (req, res) => {
  const { status, job_id } = req.query;
  let query = `SELECT a.*, j.title as job_title, j.company as job_company 
               FROM applications a JOIN jobs j ON a.job_id = j.id WHERE 1=1`;
  const params = [];
  if (status) { query += ' AND a.status = ?'; params.push(status); }
  if (job_id) { query += ' AND a.job_id = ?'; params.push(job_id); }
  query += ' ORDER BY a.created_at DESC';

  const apps = db.prepare(query).all(...params);
  res.json({ success: true, data: apps, count: apps.length });
});

// PUT update application status (admin)
app.put('/api/applications/:id', (req, res) => {
  const { status } = req.body;
  const valid = ['pending', 'reviewed', 'shortlisted', 'rejected', 'hired'];
  if (!valid.includes(status)) return res.status(400).json({ success: false, error: `Status must be one of: ${valid.join(', ')}` });

  const existing = db.prepare('SELECT * FROM applications WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ success: false, error: 'Application not found' });

  db.prepare('UPDATE applications SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ success: true, message: `Application ${status}` });
});

// ==================== API: CONTACTS ====================

// POST submit contact message
app.post('/api/contacts', (req, res) => {
  const { first_name, last_name, email, company, message } = req.body;
  if (!first_name || !last_name || !email || !message) {
    return res.status(400).json({ success: false, error: 'Missing required fields: first_name, last_name, email, message' });
  }
  const result = db.prepare(`
    INSERT INTO contacts (first_name, last_name, email, company, message)
    VALUES (?, ?, ?, ?, ?)
  `).run(first_name, last_name, email, company || '', message);

  res.status(201).json({ success: true, message: 'Message sent! We will respond within 24 hours.', id: result.lastInsertRowid });
});

// GET all contacts (admin)
app.get('/api/contacts', (req, res) => {
  const contacts = db.prepare('SELECT * FROM contacts ORDER BY created_at DESC').all();
  res.json({ success: true, data: contacts, count: contacts.length });
});

// PUT mark contact as read (admin)
app.put('/api/contacts/:id/read', (req, res) => {
  db.prepare('UPDATE contacts SET is_read = 1 WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Marked as read' });
});

// DELETE contact (admin)
app.delete('/api/contacts/:id', (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id = ?').run(req.params.id);
  res.json({ success: true, message: 'Contact deleted' });
});

// ==================== API: DASHBOARD STATS ====================
app.get('/api/stats', (req, res) => {
  const totalJobs = db.prepare('SELECT COUNT(*) as c FROM jobs WHERE is_active=1').get().c;
  const totalApps = db.prepare('SELECT COUNT(*) as c FROM applications').get().c;
  const pendingApps = db.prepare("SELECT COUNT(*) as c FROM applications WHERE status='pending'").get().c;
  const totalContacts = db.prepare('SELECT COUNT(*) as c FROM contacts').get().c;
  const unreadContacts = db.prepare('SELECT COUNT(*) as c FROM contacts WHERE is_read=0').get().c;
  const hired = db.prepare("SELECT COUNT(*) as c FROM applications WHERE status='hired'").get().c;

  const recentApps = db.prepare(`
    SELECT a.first_name, a.last_name, a.email, a.status, a.created_at, j.title as job_title
    FROM applications a JOIN jobs j ON a.job_id = j.id
    ORDER BY a.created_at DESC LIMIT 5
  `).all();

  res.json({
    success: true,
    data: { totalJobs, totalApps, pendingApps, totalContacts, unreadContacts, hired, recentApps }
  });
});

// ==================== SERVE PAGES ====================
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

// ==================== START SERVER ====================
app.listen(PORT, () => {
  console.log(`\n🚀 ═══════════════════════════════════════════════`);
  console.log(`   Talenty Consulting Server Running!`);
  console.log(`   🌐 Website:  http://localhost:${PORT}`);
  console.log(`   🔧 Admin:    http://localhost:${PORT}/admin`);
  console.log(`   📡 API:      http://localhost:${PORT}/api/jobs`);
  console.log(`═══════════════════════════════════════════════════\n`);
});
