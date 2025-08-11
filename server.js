

require('dotenv').config(); 

const express = require('express');
const multer = require('multer');
const cors = require('cors');
const mongoose = require('mongoose');
const path = require('path');
const fs = require('fs');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const bcrypt = require('bcrypt');
const { PDFDocument } = require('pdf-lib');
const { readFile } = require('fs/promises');
const { BlobServiceClient } = require('@azure/storage-blob');

const app = express();

const PORT = process.env.PORT ;
const MONGO_URI = process.env.MONGO_URI;
const SESSION_SECRET = process.env.SESSION_SECRET;
const AZURE_STORAGE_ACCOUNT_NAME = process.env.VITE_AZURE_STORAGE_ACCOUNT_NAME;
const AZURE_STORAGE_ACCOUNT_KEY = process.env.VITE_AZURE_STORAGE_ACCOUNT_KEY;
const AZURE_STORAGE_CONTAINER_NAME = process.env.VITE_AZURE_STORAGE_CONTAINER_NAME;

if (!MONGO_URI || !SESSION_SECRET) {
  console.error('FATAL ERROR: MONGO_URI and SESSION_SECRET must be set in .env file');
  process.exit(1);
}

if (!AZURE_STORAGE_ACCOUNT_NAME || !AZURE_STORAGE_ACCOUNT_KEY || !AZURE_STORAGE_CONTAINER_NAME) {
  console.error('FATAL ERROR: Azure Storage configuration must be set in .env file');
  process.exit(1);
}

// Azure Blob Storage configuration
const blobServiceClient = BlobServiceClient.fromConnectionString(
  `DefaultEndpointsProtocol=https;AccountName=${AZURE_STORAGE_ACCOUNT_NAME};AccountKey=${AZURE_STORAGE_ACCOUNT_KEY};EndpointSuffix=core.windows.net`
);
const containerClient = blobServiceClient.getContainerClient(AZURE_STORAGE_CONTAINER_NAME);


app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// Keep uploads directory for template files
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

// Use memory storage for multer since we'll upload to Azure
const storage = multer.memoryStorage();
const upload = multer({ storage });


mongoose.connect(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  
}).catch(err => {
 
  process.exit(1);
});


const nominationSchema = new mongoose.Schema({
  nominator_name: String,
  nominator_affiliation: String,
  nominator_address: String,
  nominator_email: String,
  nominator_mobile: String,
  category: String,
  nominee_name: String,
  nominee_father: String,
  nominee_degree: String,
  nominee_branch: String,
  nominee_year: Number,
  nominee_qualifications: String,
  nominee_present_position: String,
  nominee_past_positions: String,
  nominee_address: String,
  nominee_email: String,
  nominee_mobile: String,
  nominee_linkedin: String,
  nominee_other_info: String,
  assessment_note: String,
  cv_path: String
});
const Nomination = mongoose.model('Nomination', nominationSchema);


const adminSchema = new mongoose.Schema({
  username: { type: String, unique: true },
  passwordHash: String
});
const Admin = mongoose.model('Admin', adminSchema);


app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({ mongoUrl: MONGO_URI }),
  cookie: { maxAge: 24 * 60 * 60 * 1000, httpOnly: true, secure: false } 
}));


function requireAdminAuth(req, res, next) {
  if (req.session && req.session.adminUser) {
    next();
  } else {
    res.status(401).json({ error: 'Unauthorized. Please log in.' });
  }
}



app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'form.html'));
});


app.post('/submit', upload.single('cv'), async (req, res) => {
  try {
    const data = req.body;
    let cvPath = null;

    // Upload CV to Azure Blob Storage if file is provided
    if (req.file) {
      const uniqueSuffix = Date.now() + '-' + Math.floor(Math.random() * 1e9);
      const fileName = `cv-${uniqueSuffix}${path.extname(req.file.originalname)}`;
      
      const blockBlobClient = containerClient.getBlockBlobClient(fileName);
      await blockBlobClient.upload(req.file.buffer, req.file.buffer.length);
      
      cvPath = fileName; // Store just the filename, not the full path
    }

    const nomination = new Nomination({
      ...data,
      nominee_year: Number(data.nominee_year),
      cv_path: cvPath
    });

    const saved = await nomination.save();
    res.status(200).json({ message: 'Form submitted successfully', id: saved._id });
  } catch (err) {
    console.error('Form submission error:', err);
    res.status(500).json({ error: 'Submission failed' });
  }
});


app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});


app.post('/admin/login', async (req, res) => {
  const { name, password } = req.body;
  try {
    const user = await Admin.findOne({ username: name });
    if (user && await bcrypt.compare(password, user.passwordHash)) {
      req.session.adminUser = user.username;
      res.json({ success: true });
    } else {
      res.json({ success: false });
    }
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ success: false, error: 'Internal error' });
  }
});


app.post('/admin/logout', (req, res) => {
  req.session.destroy(() => res.json({ success: true }));
});


app.get('/admin/nominations', requireAdminAuth, async (req, res) => {
  try {
    const nominations = await Nomination.find({}, 'nominator_name nominee_name category cv_path');
    res.json(nominations);
  } catch (err) {
    console.error('Fetch nominations error:', err);
    res.status(500).json({ error: 'Failed to fetch nominations' });
  }
});


app.get('/admin/download/:id', requireAdminAuth, async (req, res) => {
  try {
    const record = await Nomination.findById(req.params.id);
    if (!record || !record.cv_path) return res.status(404).send('CV not found');

    // Download from Azure Blob Storage
    const blockBlobClient = containerClient.getBlockBlobClient(record.cv_path);
    
    try {
      const downloadBlockBlobResponse = await blockBlobClient.download();
      const stream = downloadBlockBlobResponse.readableStreamBody;
      
      res.set({
        'Content-Type': downloadBlockBlobResponse.contentType || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${record.cv_path}"`
      });
      
      stream.pipe(res);
    } catch (azureError) {
      console.error('Azure download error:', azureError);
      res.status(404).send('File not found in Azure storage');
    }
  } catch (err) {
    console.error('CV download error:', err);
    res.status(404).send('Download error');
  }
});


app.get('/admin/finalpdf/:id', requireAdminAuth, async (req, res) => {
  try {
    const data = await Nomination.findById(req.params.id);
    if (!data) return res.status(404).send('Nomination not found');

    const templatePath = path.join(__dirname, 'template', 'nomination_template.pdf');
    const templateBytes = await readFile(templatePath);
    const pdfDoc = await PDFDocument.load(templateBytes);
    const form = pdfDoc.getForm();

    
    form.getTextField('name_nominator')?.setText(data.nominator_name || '');
    form.getTextField('nominator_designation')?.setText(data.nominator_affiliation || '');
    form.getTextField('nominator_address')?.setText(data.nominator_address || '');
    form.getTextField('nominator_email')?.setText(data.nominator_email || '');
    form.getTextField('nominator_mobile')?.setText(data.nominator_mobile || '');
    form.getTextField('nomination_category')?.setText(data.category || '');
    form.getTextField('nominee_name')?.setText(data.nominee_name || '');
    form.getTextField('nominee_father_name')?.setText(data.nominee_father || '');
    form.getTextField('degree_obtained')?.setText(data.nominee_degree || '');
    form.getTextField('branch')?.setText(data.nominee_branch || '');
    form.getTextField('passing_year')?.setText(data.nominee_year?.toString() || '');
    form.getTextField('other_qualification_details')?.setText(data.nominee_qualifications || '');
    form.getTextField('present_position')?.setText(data.nominee_present_position || '');
    form.getTextField('past_position')?.setText(data.nominee_past_positions || '');
    form.getTextField('communication_address')?.setText(data.nominee_address || '');
    form.getTextField('nominee_email')?.setText(data.nominee_email || '');
    form.getTextField('nominee_mobile')?.setText(data.nominee_mobile || '');
    form.getTextField('achivement')?.setText(data.nominee_qualifications || '');
    form.getTextField('webpage_url')?.setText(data.nominee_linkedin || '');
    form.getTextField('other_information')?.setText(data.nominee_other_info || '');
    form.getTextField('assessment')?.setText(data.assessment_note || '');
    form.getTextField('date_of_submission')?.setText(new Date().toLocaleString());

    form.flatten();

    const pdfBytes = await pdfDoc.save();

    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename=nomination-${data._id}.pdf`
    });

    res.send(pdfBytes);
  } catch (err) {
    console.error('PDF generation error:', err);
    res.status(500).send('PDF generation failed');
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
