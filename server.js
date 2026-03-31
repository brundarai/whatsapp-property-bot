const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Initialize Twilio client
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER;
const EXCEL_FILE = path.join('/tmp', 'property_data.xlsx');

/**
 * Extract data from message
 */
function parseMessage(message) {
  const data = {
    name: extractValue(message, ['Name', '1.']),
    phone: extractValue(message, ['WhatsApp / Contact Number', '2.']),
    requirement: extractValue(message, ['Requirement', '3.']),
    configuration: extractValue(message, ['Configuration', '4.']),
    furnishing: extractValue(message, ['Furnishing', '5.']),
    location: extractValue(message, ['Location', 'Preferred Location', '6.']),
    tenantType: extractValue(message, ['Tenant Type', '7.']),
    budget: extractValue(message, ['Budget', '8.']),
    moveInDate: extractValue(message, ['Move-in Date', '9.']),
    parking: extractValue(message, ['Parking', '10.']),
    foodPref: extractValue(message, ['Food Preference', '11.']),
    fullMessage: message
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
 * Initialize or get Excel workbook
 */
async function getOrCreateWorkbook() {
  let workbook;
  
  if (fs.existsSync(EXCEL_FILE)) {
    workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(EXCEL_FILE);
  } else {
    workbook = new ExcelJS.Workbook();
    
    const sheet = workbook.addWorksheet('Property Inquiries');
    sheet.columns = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Name', key: 'name', width: 15 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Requirement', key: 'requirement', width: 12 },
      { header: 'Configuration', key: 'configuration', width: 12 },
      { header: 'Furnishing', key: 'furnishing', width: 15 },
      { header: 'Location', key: 'location', width: 20 },
      { header: 'Tenant Type', key: 'tenantType', width: 12 },
      { header: 'Budget', key: 'budget', width: 15 },
      { header: 'Move-in Date', key: 'moveInDate', width: 15 },
      { header: 'Parking Required', key: 'parking', width: 12 },
      { header: 'Food Preference', key: 'foodPref', width: 12 },
    ];
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFD3D3D3' }
    };
    
    await workbook.xlsx.writeFile(EXCEL_FILE);
  }
  
  return workbook;
}

/**
 * Add record to Excel
 */
async function addToExcel(name, phone, message) {
  try {
    const workbook = await getOrCreateWorkbook();
    const worksheet = workbook.getWorksheet('Property Inquiries');
    
    // Parse message to extract data
    const parsedData = parseMessage(message);
    
    const row = {
      date: new Date().toLocaleDateString('en-IN'),
      name: name || parsedData.name || 'Unknown',
      phone: phone || parsedData.phone || '',
      requirement: parsedData.requirement,
      configuration: parsedData.configuration,
      furnishing: parsedData.furnishing,
      location: parsedData.location,
      tenantType: parsedData.tenantType,
      budget: parsedData.budget,
      moveInDate: parsedData.moveInDate,
      parking: parsedData.parking,
      foodPref: parsedData.foodPref,
    };
    
    worksheet.addRow(row);
    await workbook.xlsx.writeFile(EXCEL_FILE);
    
    console.log(`✅ Record added to Excel`);
    return true;
  } catch (error) {
    console.error('Error adding to Excel:', error);
    throw error;
  }
}

/**
 * Send WhatsApp message confirmation
 */
async function sendConfirmation(toPhone, message) {
  const confirmationMsg = `✅ Thanks for your inquiry!\n\nYour message has been saved.\n\nWe'll get back to you soon!`;

  try {
    // Remove 'whatsapp:' prefix if it exists in TWILIO_PHONE
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
    // Skip if message is too short (not a real inquiry)
    if (!messageBody || messageBody.trim().length < 5) {
      res.sendStatus(200);
      return;
    }

    // Save to Excel with parsed data
    await addToExcel(senderName, fromPhone, messageBody);

    // Send confirmation
    await sendConfirmation(fromPhone, messageBody);

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

/**
 * Download Excel file endpoint
 */
app.get('/download-excel', (req, res) => {
  if (fs.existsSync(EXCEL_FILE)) {
    res.download(EXCEL_FILE, 'property_data.xlsx');
  } else {
    res.status(404).json({ error: 'No data file found yet' });
  }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 WhatsApp bot listening on port ${PORT}`);
});
