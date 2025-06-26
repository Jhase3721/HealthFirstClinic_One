const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');

require('dotenv').config();

console.log('MONGODB_URI:', process.env.MONGODB_URI ? 'Set' : 'Undefined');
console.log('ADMIN_USERNAME:', process.env.ADMIN_USERNAME);
console.log('ADMIN_PASSWORD:', process.env.ADMIN_PASSWORD);
console.log('SECRET_KEY:', process.env.SECRET_KEY ? 'Set' : 'Undefined');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Multer configuration for file uploads
const upload = multer({ dest: 'public/uploads/' });

// Middleware
app.use(cookieParser());
app.use(express.json());
// Serve static files, including uploads
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Root route to explicitly serve font.html
app.get('/', (req, res) => {
  console.log('Serving font.html');
  const filePath = path.join(__dirname, 'public', 'font.html');
  res.sendFile(filePath, err => {
    if (err) {
      console.error('Error serving font.html:', err);
      res.status(500).send('Error loading page');
    } else {
      console.log('Successfully served font.html');
    }
  });
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  serverSelectionTimeoutMS: 30000,
})
  .then(async () => {
    console.log('Connected to MongoDB');
    const status = await ClinicStatus.findOne();
    if (!status) {
      await new ClinicStatus({ isOpen: true }).save();
      console.log('Initialized ClinicStatus');
    }
  })
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Schemas and Models
const appointmentSchema = new mongoose.Schema({
  name: String,
  age: Number,
  address: String,
  email: String,
  cpNumber: String,
  date: String,
  time: String,
  weight: Number,
  bloodPressure: String,
  heartBeat: Number,
  message: String,
  picture: String, // Added for picture URL
});
const Appointment = mongoose.model('Appointment', appointmentSchema);

const eventSchema = new mongoose.Schema({
  title: String,
  date: String,
  time: String,
  duration: String,
  clinicStatus: String,
  description: String,
});
const Event = mongoose.model('Event', eventSchema);

const clinicStatusSchema = new mongoose.Schema({
  isOpen: Boolean,
});
const ClinicStatus = mongoose.model('ClinicStatus', clinicStatusSchema);

// Routes
app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USERNAME && password === process.env.ADMIN_PASSWORD) {
    const token = jwt.sign({ username }, process.env.SECRET_KEY, { expiresIn: '1h' });
    res.cookie('token', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production' });
    res.json({ success: true });
  } else {
    res.status(401).json({ error: 'Invalid credentials' });
  }
});

const authMiddleware = (req, res, next) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const decoded = jwt.verify(token, process.env.SECRET_KEY);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

app.get('/api/appointments', authMiddleware, async (req, res) => {
  try {
    const appointments = await Appointment.find();
    res.json(appointments);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/events', authMiddleware, async (req, res) => {
  try {
    const event = new Event(req.body);
    await event.save();
    io.emit('refresh-events');
    res.status(201).json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/clinic-status/toggle', authMiddleware, async (req, res) => {
  try {
    const status = await ClinicStatus.findOne();
    status.isOpen = !status.isOpen;
    await status.save();
    io.emit('clinic-status-changed', status);
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/events', async (req, res) => {
  try {
    const events = await Event.find();
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Updated appointment booking route with file upload
app.post('/api/appointments', upload.single('picture'), async (req, res) => {
  try {
    const appointment = new Appointment({
      name: req.body.name,
      age: req.body.age,
      address: req.body.address,
      email: req.body.email,
      cpNumber: req.body.cpNumber,
      date: req.body.date,
      time: req.body.time,
      weight: req.body.weight,
      bloodPressure: req.body.bloodPressure,
      heartBeat: req.body.heartBeat,
      message: req.body.message,
      picture: req.file ? `/uploads/${req.file.filename}` : null // Save picture URL
    });
    await appointment.save();
    res.status(201).json({ message: 'Appointment booked successfully', pictureUrl: appointment.picture });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/clinic-status', async (req, res) => {
  try {
    const status = await ClinicStatus.findOne();
    res.json(status);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

io.on('connection', (socket) => {
  console.log('Client connected');
  socket.on('new-event', () => io.emit('refresh-events'));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
