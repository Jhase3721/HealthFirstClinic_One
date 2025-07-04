const express = require('express');
const mongoose = require('mongoose');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const fetch = require('node-fetch');

require('dotenv').config({ path: path.join(__dirname, '.env') });

// Log environment variables to check if they're set
console.log('MONGODB_URI:', process.env.MONGODB_URI ? 'Set' : 'Undefined');
console.log('ADMIN_USERNAME:', process.env.ADMIN_USERNAME);
console.log('ADMIN_PASSWORD:', process.env.ADMIN_PASSWORD);
console.log('SECRET_KEY:', process.env.SECRET_KEY ? 'Set' : 'Undefined');
console.log('DISCORD_WEBHOOK_URL:', process.env.DISCORD_WEBHOOK_URL ? 'Set' : 'Undefined');

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Multer configuration for file uploads
const upload = multer({ dest: 'public/uploads/' });

// Middleware
app.use(cookieParser());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

// Root route to serve font.html
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
  serverSelectionTimeoutMS: 30000
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
  picture: String,
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
  if (!token) return res.status(401).json({ error: 'Unauthorized' });
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
    let status = await ClinicStatus.findOne();
    if (!status) {
      status = new ClinicStatus({ isOpen: true });
      await status.save();
    }
    status.isOpen = !status.isOpen;
    await status.save();
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
      picture: req.file ? `/uploads/${req.file.filename}` : null
    });
    await appointment.save();
    console.log('Appointment saved:', appointment);

    const discordWebhookUrl = process.env.DISCORD_WEBHOOK_URL;
    if (discordWebhookUrl) {
      console.log('Attempting to send Discord notification');

      // Construct the Discord embed with full user information
      const embed = {
        title: "New Appointment Booked",
        color: 5197365, // Indigo color
        fields: [
          { name: "Name", value: appointment.name || "N/A", inline: false },
          { name: "Age", value: appointment.age ? appointment.age.toString() : "N/A", inline: false },
          { name: "Address", value: appointment.address || "N/A", inline: false },
          { name: "Email", value: appointment.email || "N/A", inline: false },
          { name: "Contact Number", value: appointment.cpNumber || "N/A", inline: false },
          { name: "Appointment Date", value: appointment.date || "N/A", inline: false },
          { name: "Appointment Time", value: appointment.time || "N/A", inline: false },
          { name: "Weight", value: appointment.weight ? `${appointment.weight} kg` : "N/A", inline: false },
          { name: "Blood Pressure", value: appointment.bloodPressure || "N/A", inline: false },
          { name: "Heart Rate", value: appointment.heartBeat ? `${appointment.heartBeat} bpm` : "N/A", inline: false },
          { name: "Message", value: appointment.message || "N/A", inline: false }
        ],
        timestamp: new Date(),
        footer: {
          text: "HealthFirstClinic"
        }
      };

      // Add thumbnail if picture is available
      if (appointment.picture) {
        const pictureUrl = `${req.protocol}://${req.get('host')}${appointment.picture}`;
        embed.thumbnail = { url: pictureUrl };
      }

      const discordMessage = { embeds: [embed] };

      const maxRetries = 3;
      let retryCount = 0;
      let success = false;

      while (retryCount < maxRetries && !success) {
        try {
          const response = await fetch(discordWebhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(discordMessage)
          });
          if (response.ok) {
            console.log('Discord notification sent successfully');
            success = true;
          } else if (response.status === 429) {
            const retryAfter = response.headers.get('Retry-After') || 5;
            console.log(`Rate limited. Retrying after ${retryAfter} seconds...`);
            await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
            retryCount++;
          } else {
            console.error('Discord notification failed:', response.status, await response.text());
            break;
          }
        } catch (err) {
          console.error('Error sending Discord notification:', err);
          break;
        }
      }
      if (!success) console.log('Failed to send Discord notification after retries');
    } else {
      console.log('DISCORD_WEBHOOK_URL not set');
    }

    res.status(201).json({ message: 'Appointment booked successfully', pictureUrl: appointment.picture });
  } catch (err) {
    console.error('Error booking appointment:', err);
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
  socket.on('new-event', () => io.emit('refresh-events'));
  socket.on('open-close', (status) => io.emit('open-close', status));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
