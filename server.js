const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const ExcelJS = require('exceljs');
const axios = require('axios');
require('dotenv').config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Initialize Twilio client
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER;

// Microsoft Graph API credentials
const GRAPH_API_TOKEN = process.env.MICROSOFT_GRAPH_TOKEN;
const ONEDRIVE_FILE_ID = process.env.ONEDRIVE_FILE_ID;

// Your business number to ignore
const BUSINESS_PHONE = '919380729579';

/**
 * Extract data from message
 */
function parseMessage(message) {
  const data = {
    name: extractValue(message, ['Name', '1.']),
    phone: extractValue(message, ['WhatsApp / Contact Number', 'Contact Number', '2.']),
    requirement: extractValue(message, ['Requirement', '3.']),
    configuration: extractValue(message, ['Configuration', '4.']),
    furnishing: extractValue(message, ['Furnishing', '5.']),
    location: extractValue(message, ['Location', 'Preferred Location', '6.']),
    tenantType: extractValue(message, ['Tenant Type', '7.']),
    budget: extractValue(message, ['Budget', '8.']),
    moveInDate: extractValue(message, ['Move-in Date', '9.']),
    parking: extractValue(message, ['Parking', '10.']),
    foodPref: extractValue(message, ['Food Preference', '11.']),
  };
  return data;
}

/**
 * Extract value from message
 */
function extractValue(message, keywords) {
  for (const keyword of keywords) {
    const regex = new RegExp(`${keyword}[^–-]*[–-]\\s*([^\\n]+)`, 'i');
    const match = message.match(regex);
    if (match) {
      return match[1].trim();
    }
  }
  return '';
}

/**
 * Get file from OneDrive and add record
 */
async function addToOneDrive(message) {
  try {
    console.log('Starting OneDrive upload...');
    console.log('Token:', GRAPH_API_TOKEN ? 'Present' : 'Missing');
    console.log('File ID:', ONEDRIVE_FILE_ID ? 'Present' : 'Missing');

    // Download current file
    const downloadUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${ONEDRIVE_FILE_ID}/content`;
    console.log('Downloading from:', downloadUrl);

    const response = await axios.get(downloadUrl, {
      headers: {
        'Authorization': `Bearer ${GRAPH_API_TOKEN}`
      },
      responseType: 'arraybuffer'
    });

    console.log('File downloaded successfully');

    // Load workbook
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.data);
    
    // Get or create sheet
    let worksheet = workbook.getWorksheet('NammaHood Database');
    if (!worksheet) {
      console.log('Creating new sheet: NammaHood Database');
      worksheet = workbook.addWorksheet('NammaHood Database');
      worksheet.columns = [
        { header: 'Date', key: 'date', width: 12 },
        { header: 'Type', key: 'type', width: 10 },
        { header: 'Name', key: 'name', width: 15 },
        { header: 'Phone', key: 'phone', width: 15 },
        { header: 'Requirement', key: 'requirement', width: 12 },
        { header: 'Configuration', key: 'configuration', width: 12 },
        { header: 'Furnishing', key: 'furnishing', width: 15 },
        { header: 'Location', key: 'location', width: 20 },
        { header: 'Tenant Type', key: 'tenantType', width: 12 },
        { header: 'Budget', key: 'budget', width: 15 },
        { header: 'Move-in Date', key: 'moveInDate', width: 15 },
        { header: 'Parking', key: 'parking', width: 12 },
        { header: 'Food Preference', key: 'foodPref', width: 12 },
        { header: 'Notes', key: 'notes', width: 20 },
      ];
      
      // Format header
      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFD3D3D3' }
      };
    }

    // Parse message
    const parsedData = parseMessage(message);
    const customerName = parsedData.name || 'Unknown';
    const customerPhone = parsedData.phone || '';

    console.log(`Extracted - Name: ${customerName}, Phone: ${customerPhone}`);

    // Add new row
    const row = {
      date: new Date().toLocaleDateString('en-IN'),
      type: '',
      name: customerName,
      phone: customerPhone,
      requirement: parsedData.requirement,
      configuration: parsedData.configuration,
      furnishing: parsedData.furnishing,
      location: parsedData.location,
      tenantType: parsedData.tenantType,
      budget: parsedData.budget,
      moveInDate: parsedData.moveInDate,
      parking: parsedData.parking,
      foodPref: parsedData.foodPref,
      notes: '',
    };

    worksheet.addRow(row);
    console.log('Row added to worksheet');

    // Convert to buffer
    const buffer = await workbook.xlsx.writeBuffer();
    console.log('Buffer created, uploading to OneDrive...');

    // Upload back to OneDrive
    const uploadUrl = `https://graph.microsoft.com/v1.0/me/drive/items/${ONEDRIVE_FILE_ID}/content`;
    await axios.put(uploadUrl, buffer, {
      headers: {
        'Authorization': `Bearer ${GRAPH_API_TOKEN}`,
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      }
    });

    console.log(`✅ Record added to OneDrive NammaHood Database`);
    return true;
  } catch (error) {
    console.error('Error adding to OneDrive:', error.response?.data || error.message);
    throw error;
  }
}

/**
 * Send WhatsApp message confirmation
 */
async function sendConfirmation(toPhone) {
  const confirmationMsg = `✅ Thanks for your inquiry!\n\nYour information has been saved.\n\nWe'll get back to you soon!`;

  try {
    let fromPhone = TWILIO_PHONE;
    if (fromPhone.startsWith('whatsapp:')) {
      fromPhone = fromPhone.replace('whatsapp:', '');
    }

    await client.messages.create({
      from: `whatsapp:${fromPhone}`,
      to: `whatsapp:${toPhone}`,
      body: confirmationMsg,
    });
    console.log(`Confirmation sent to ${toPhone}`);
  } catch (error) {
    console.error('Error sending confirmation:', error);
  }
}

/**
 * Main webhook endpoint for Twilio
 */
app.post('/webhook', async (req, res) => {
  const messageBody = req.body.Body;
  const fromPhone = req.body.From.replace('whatsapp:', '');
  const senderName = req.body.ProfileName || 'Unknown';

  console.log(`\n📨 New message from ${senderName} (${fromPhone}):\n${messageBody}\n`);

  try {
    if (!messageBody || messageBody.trim().length < 5) {
      res.sendStatus(200);
      return;
    }

    // Add to OneDrive (extracts customer name/phone from message, not from sender)
    await addToOneDrive(messageBody);

    // Send confirmation (send to whoever sent the message)
    await sendConfirmation(fromPhone);

    res.sendStatus(200);
  } catch (error) {
    console.error('Error processing message:', error);
    res.sendStatus(500);
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({ status: 'Bot is running!' });
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 WhatsApp bot listening on port ${PORT}`);
});
