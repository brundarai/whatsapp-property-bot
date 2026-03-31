const express = require('express');
const bodyParser = require('body-parser');
const twilio = require('twilio');
const Anthropic = require('@anthropic-ai/sdk');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

const app = express();
app.use(bodyParser.urlencoded({ extended: false }));
app.use(bodyParser.json());

// Initialize clients
const client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const TWILIO_PHONE = process.env.TWILIO_PHONE_NUMBER;
const EXCEL_FILE = path.join('/tmp', 'property_data.xlsx');

/**
 * Extract tenant/owner info using Claude AI
 */
async function extractPropertyInfo(messageText, senderPhone, senderName) {
  const systemPrompt = `You are an AI assistant that extracts property rental information from WhatsApp messages.
Extract the following information and return ONLY valid JSON (no markdown, no explanation):

For TENANTS:
{
  "type": "tenant",
  "name": "person's name or null",
  "phone": "phone number or null",
  "configuration": "1BHK, 2BHK, 3BHK etc or null",
  "furnishing": "Furnished, Semi-Furnished, Unfurnished or null",
  "locations": ["location1", "location2"],
  "budget_min": number or null,
  "budget_max": number or null,
  "tenant_type": "Bachelor, Family, Student etc or null",
  "move_in_date": "date or null",
  "parking_needed": true/false or null,
  "pets": true/false or null,
  "special_requirements": "string or null",
  "confidence": 0.8
}

For OWNERS:
{
  "type": "owner",
  "name": "owner's name or null",
  "phone": "phone number or null",
  "configuration": "1BHK, 2BHK, 3BHK etc or null",
  "furnishing": "Furnished, Semi-Furnished, Unfurnished or null",
  "location": "property location or null",
  "rental": number or null,
  "deposit": number or null,
  "maintenance": number or null,
  "parking": "2-wheeler, Car, Both, None or null",
  "pets_allowed": true/false or null,
  "move_in_date": "date or null",
  "occupancy_type": "Bachelor, Family, Any etc or null",
  "special_restrictions": "string or null",
  "confidence": 0.8
}

RULES:
- Extract phone numbers EXACTLY as they appear
- For budget, extract as integers (remove 'k', rupee symbol, etc)
- If information is missing, use null
- Return ONLY the JSON object, nothing else
- Always use confidence 0.8 or higher`;

  const userPrompt = `Extract information from this WhatsApp message:
Sender Phone: ${senderPhone}
Sender Name: ${senderName}
Message: ${messageText}`;

  try {
    const response = await anthropic.messages.create({
      model: 'claude-3-haiku-20250307',
      max_tokens: 1000,
      system: systemPrompt,
      messages: [
        {
          role: 'user',
          content: userPrompt,
        },
      ],
    });

    const responseText = response.content[0].type === 'text' ? response.content[0].text : '';
    const cleanedText = responseText.replace(/```json\n?|\n?```/g, '').trim();
    const extractedData = JSON.parse(cleanedText);
    
    return extractedData;
  } catch (error) {
    console.error('Error extracting info:', error);
    return null;
  }
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
    
    // Create Tenants sheet
    const tenantsSheet = workbook.addWorksheet('Tenants');
    tenantsSheet.columns = [
      { header: 'Name', key: 'name', width: 15 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Configuration', key: 'configuration', width: 12 },
      { header: 'Furnishing', key: 'furnishing', width: 12 },
      { header: 'Locations', key: 'locations', width: 20 },
      { header: 'Budget Min', key: 'budget_min', width: 12 },
      { header: 'Budget Max', key: 'budget_max', width: 12 },
      { header: 'Tenant Type', key: 'tenant_type', width: 12 },
      { header: 'Move In Date', key: 'move_in_date', width: 12 },
      { header: 'Parking Needed', key: 'parking_needed', width: 12 },
      { header: 'Pets', key: 'pets', width: 10 },
      { header: 'Special Requirements', key: 'special_requirements', width: 25 },
      { header: 'Date Added', key: 'date_added', width: 15 },
    ];
    tenantsSheet.getRow(1).font = { bold: true };
    
    // Create Owners sheet
    const ownersSheet = workbook.addWorksheet('Owners');
    ownersSheet.columns = [
      { header: 'Name', key: 'name', width: 15 },
      { header: 'Phone', key: 'phone', width: 15 },
      { header: 'Configuration', key: 'configuration', width: 12 },
      { header: 'Furnishing', key: 'furnishing', width: 12 },
      { header: 'Location', key: 'location', width: 20 },
      { header: 'Rental', key: 'rental', width: 12 },
      { header: 'Deposit', key: 'deposit', width: 12 },
      { header: 'Maintenance', key: 'maintenance', width: 12 },
      { header: 'Parking', key: 'parking', width: 12 },
      { header: 'Pets Allowed', key: 'pets_allowed', width: 12 },
      { header: 'Move In Date', key: 'move_in_date', width: 12 },
      { header: 'Occupancy Type', key: 'occupancy_type', width: 12 },
      { header: 'Special Restrictions', key: 'special_restrictions', width: 25 },
      { header: 'Date Added', key: 'date_added', width: 15 },
    ];
    ownersSheet.getRow(1).font = { bold: true };
    
    await workbook.xlsx.writeFile(EXCEL_FILE);
  }
  
  return workbook;
}

/**
 * Add record to Excel
 */
async function addToExcel(type, data) {
  try {
    const workbook = await getOrCreateWorkbook();
    const sheetName = type === 'tenant' ? 'Tenants' : 'Owners';
    const worksheet = workbook.getWorksheet(sheetName);
    
    const row = {
      name: data.name || 'Unknown',
      phone: data.phone || '',
      configuration: data.configuration || '',
      furnishing: data.furnishing || '',
      date_added: new Date().toLocaleDateString('en-IN'),
    };
    
    if (type === 'tenant') {
      row.locations = (data.locations || []).join(', ');
      row.budget_min = data.budget_min || '';
      row.budget_max = data.budget_max || '';
      row.tenant_type = data.tenant_type || '';
      row.move_in_date = data.move_in_date || '';
      row.parking_needed = data.parking_needed ? 'Yes' : 'No';
      row.pets = data.pets ? 'Yes' : 'No';
      row.special_requirements = data.special_requirements || '';
    } else {
      row.location = data.location || '';
      row.rental = data.rental || '';
      row.deposit = data.deposit || '';
      row.maintenance = data.maintenance || '';
      row.parking = data.parking || '';
      row.pets_allowed = data.pets_allowed ? 'Yes' : 'No';
      row.move_in_date = data.move_in_date || '';
      row.occupancy_type = data.occupancy_type || '';
      row.special_restrictions = data.special_restrictions || '';
    }
    
    worksheet.addRow(row);
    await workbook.xlsx.writeFile(EXCEL_FILE);
    
    console.log(`✅ Record added to Excel: ${sheetName}`);
    return true;
  } catch (error) {
    console.error('Error adding to Excel:', error);
    throw error;
  }
}

/**
 * Send WhatsApp message confirmation
 */
async function sendConfirmation(toPhone, type, name, details) {
  const message = type === 'tenant'
    ? `✅ Got it! I've saved your requirements:\n\n📋 Name: ${name}\n🏠 Looking for: ${details.configuration || 'Any'}\n📍 Location: ${details.locations?.join(', ') || 'Not specified'}\n💰 Budget: ₹${details.budget_min || '?'}k - ₹${details.budget_max || '?'}k\n\nI'll notify you when matching properties are available!`
    : `✅ Property saved!\n\n🏠 ${details.configuration} in ${details.location}\n💰 Rent: ₹${details.rental || '?'}k\n📞 Contact: ${name}\n\nI'll connect interested tenants with you!`;

  try {
    await client.messages.create({
      from: `whatsapp:${TWILIO_PHONE}`,
      to: `whatsapp:${toPhone}`,
      body: message,
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
    const extractedData = await extractPropertyInfo(messageBody, fromPhone, senderName);
    console.log('Extracted data:', JSON.stringify(extractedData, null, 2));

    if (!extractedData || extractedData.confidence < 0.5) {
      console.log('Low confidence or invalid data. Skipping.');
      res.sendStatus(200);
      return;
    }

    await addToExcel(extractedData.type, extractedData);

    await sendConfirmation(fromPhone, extractedData.type, extractedData.name || senderName, extractedData);

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
